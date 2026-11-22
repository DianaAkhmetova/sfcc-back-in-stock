'use strict';

/**
 * Delivery providers, selected with the job parameter DeliveryProvider:
 *   webhook  (default) - external REST API via the Service Framework (e.g. Webhook.site); email + SMS payload.
 *   sfccMail           - platform email (dw.net.Mail). Email only; SMS is skipped.
 *                        Sender = email.from in templates/resources/backinstock.properties.
 *
 * provider.send(message) -> {ok, httpStatus, unavailableReason, errorMessage}
 */
var Mail = require('dw/net/Mail');
var Resource = require('dw/web/Resource');
var webhookService = require('*/cartridge/scripts/backinstock/services/webhookService');

var webhook = {
    send: function (message) {
        return webhookService.send(message);
    }
};

var sfccMail = {
    send: function (message) {
        var mail = new Mail();
        mail.setFrom(Resource.msg('email.from', 'backinstock', null));
        mail.addTo(message.email.to);
        mail.setSubject(message.email.subject);
        mail.setContent(message.email.html, 'text/html', 'UTF-8');
        var status = mail.send();
        var ok = !status.isError();
        return {
            ok: ok,
            // Platform mail errors are opaque: treat as temporary (retried next run).
            httpStatus: ok ? 200 : 503,
            unavailableReason: null,
            errorMessage: ok ? null : status.getMessage()
        };
    }
};

/** @param {string} name - 'webhook' | 'sfccMail' */
function get(name) {
    return name === 'sfccMail' ? sfccMail : webhook;
}

module.exports = { get: get };
