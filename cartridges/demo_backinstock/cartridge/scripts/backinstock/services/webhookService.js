'use strict';

/**
 * Outbound notification call to the external (mock) messaging provider, e.g. Webhook.site.
 *
 * Security:
 *  - HTTPS endpoint + secret live in the BM Service Credential (encrypted at rest, never in code).
 *  - Body is signed: X-BIS-Signature = "sha256=" + HMAC_SHA256(secret, timestamp + "." + body),
 *    with X-BIS-Timestamp so the receiver can reject replays (Stripe-style scheme).
 *  - Idempotency-Key lets the provider drop duplicates if we retry after an ambiguous failure.
 *  - Communication log masks emails / phone numbers (PII).
 *
 * Resilience is layered:
 *  - Service profile (services.xml): timeout, rate limiter, circuit breaker - enforced by the platform.
 *  - The job classifies results; temporary failures are retried by the next hourly run.
 */
var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Mac = require('dw/crypto/Mac');
var Encoding = require('dw/crypto/Encoding');
var constants = require('*/cartridge/scripts/backinstock/constants');

var EMAIL_PATTERN = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@/g;
var PHONE_PATTERN = /\+\d{3,}(\d{4})/g;

function maskPii(message) {
    if (!message) return message;
    return String(message)
        .replace(EMAIL_PATTERN, '$1***@')
        .replace(PHONE_PATTERN, '+*******$1')
        // Rendered email HTML is large and PII-laden: drop it from logs entirely.
        .replace(/"html"\s*:\s*"(?:[^"\\]|\\.)*"/g, '"html":"[omitted]"');
}

function createService() {
    return LocalServiceRegistry.createService(constants.WEBHOOK_SERVICE_ID, {
        createRequest: function (svc, args) {
            svc.setRequestMethod('POST');
            svc.addHeader('Content-Type', 'application/json; charset=utf-8');
            svc.addHeader('Accept', 'application/json');
            svc.addHeader('Idempotency-Key', args.idempotencyKey);
            svc.addHeader('User-Agent', 'sfcc-back-in-stock-demo/1.0');

            var credential = svc.getConfiguration().getCredential();
            var secret = credential ? credential.getPassword() : null;
            if (secret) {
                var timestamp = String(Math.floor(Date.now() / 1000));
                var signature = new Mac(Mac.HMAC_SHA_256).digest(timestamp + '.' + args.body, secret);
                svc.addHeader('X-BIS-Timestamp', timestamp);
                svc.addHeader('X-BIS-Signature', 'sha256=' + Encoding.toHex(signature));
            }
            return args.body;
        },

        parseResponse: function (svc, client) {
            return { statusCode: client.getStatusCode(), text: client.getText() };
        },

        // Used when the service is switched to "mock" mode in BM - handy for demos without network.
        mockCall: function () {
            return { statusCode: 202, statusMessage: 'Accepted', text: '{"mock":true}' };
        },

        getRequestLogMessage: function (req) {
            return maskPii(req);
        },
        getResponseLogMessage: function (res) {
            return res && res.text ? maskPii(res.text) : String(res);
        },
        filterLogMessage: function (msg) {
            return maskPii(msg);
        }
    });
}

/**
 * @param {Object} payload - provider-neutral notification payload (see payloadBuilder)
 * @returns {{ok: boolean, httpStatus: number, unavailableReason: string|null, errorMessage: string|null}}
 */
function send(payload) {
    var svc = createService();
    var result = svc.call({ body: JSON.stringify(payload), idempotencyKey: payload.idempotencyKey });

    var httpStatus = 0;
    try {
        var client = svc.getClient();
        if (client) httpStatus = client.getStatusCode();
    } catch (e) {
        // No client when the call never left (rate limited / circuit open / mock).
    }
    if (result.ok && result.object && result.object.statusCode) httpStatus = result.object.statusCode;
    if (!result.ok && result.error) httpStatus = result.error;

    return {
        ok: result.ok,
        httpStatus: httpStatus,
        unavailableReason: result.unavailableReason || null,
        errorMessage: result.ok ? null : maskPii(result.errorMessage || result.msg || result.status)
    };
}

module.exports = { send: send, maskPii: maskPii };
