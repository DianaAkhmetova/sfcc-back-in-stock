'use strict';

/**
 * Input validation / normalization (no dw.* dependencies -> unit-testable in Node).
 */

var MAX_EMAIL_LENGTH = 254;
var EMAIL_REGEX = /^[^\s@"(),:;<>[\]\\]+@[^\s@"(),:;<>[\]\\]+\.[^\s@"(),:;<>[\]\\.]{2,}$/;
var E164_REGEX = /^\+[1-9]\d{6,14}$/;
var PRODUCT_ID_REGEX = /^[A-Za-z0-9._-]{1,100}$/;

function normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/** Strip formatting characters; "00" international prefix -> "+". */
function normalizePhone(phone) {
    if (typeof phone !== 'string') return '';
    var value = phone.trim().replace(/[\s().\-/]/g, '');
    if (value.indexOf('00') === 0) value = '+' + value.substring(2);
    return value;
}

/**
 * @param {Object} body - parsed JSON body
 * @returns {{valid: boolean, field?: string, reason?: string, value?: Object}}
 */
function validateSubscriptionRequest(body) {
    if (!body || typeof body !== 'object') {
        return { valid: false, field: 'body', reason: 'Request body must be a JSON object.' };
    }

    var productId = typeof body.productId === 'string' ? body.productId.trim() : '';
    if (!PRODUCT_ID_REGEX.test(productId)) {
        return { valid: false, field: 'productId', reason: 'productId is required.' };
    }

    var email = normalizeEmail(body.email);
    if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(email)) {
        return { valid: false, field: 'email', reason: 'A valid email address is required.' };
    }

    var phone = normalizePhone(body.phone);
    if (phone && !E164_REGEX.test(phone)) {
        return { valid: false, field: 'phone', reason: 'phone must be in E.164 format, e.g. +15551234567.' };
    }
    if (phone && body.smsConsent !== true) {
        return { valid: false, field: 'smsConsent', reason: 'smsConsent must be true when a phone number is provided.' };
    }

    return {
        valid: true,
        value: { productId: productId, email: email, phone: phone || null, smsConsent: Boolean(phone) }
    };
}

module.exports = {
    normalizeEmail: normalizeEmail,
    normalizePhone: normalizePhone,
    validateSubscriptionRequest: validateSubscriptionRequest
};
