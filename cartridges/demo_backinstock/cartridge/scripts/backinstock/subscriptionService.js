'use strict';

/**
 * "Notify me when SKU X is back" - called by the custom SCAPI endpoint.
 */
var constants = require('*/cartridge/scripts/backinstock/constants');
var validation = require('*/cartridge/scripts/backinstock/lib/validation');
var productAvailability = require('*/cartridge/scripts/backinstock/productAvailability');
var repository = require('*/cartridge/scripts/backinstock/subscriptionRepository');

var API_STATUS = constants.API_STATUS;

function result(httpStatus, body) {
    return { httpStatus: httpStatus, body: body };
}

/**
 * @param {Object} rawBody - parsed request JSON
 * @returns {{httpStatus: number, body: Object}}
 */
function subscribe(rawBody) {
    var validated = validation.validateSubscriptionRequest(rawBody);
    if (!validated.valid) {
        return result(400, { status: API_STATUS.INVALID, field: validated.field, detail: validated.reason });
    }
    var input = validated.value;

    // Variant-level SKU resolution: inventory exists only on orderable SKUs, never on a master.
    var resolved = productAvailability.resolveSku(input.productId);
    if (!resolved) {
        return result(400, {
            status: API_STATUS.INVALID,
            field: 'productId',
            detail: 'Unknown product, or not a concrete variant SKU (masters and sets are not allowed).'
        });
    }

    var outcome = repository.addSubscriber(input.productId, resolved.masterId, {
        email: input.email,
        phone: input.phone,
        smsConsent: input.smsConsent,
        status: constants.STATUS.PENDING,
        attempts: 0,
        subscribedAt: Date.now()
    });

    if (outcome === 'exists') {
        return result(200, { status: API_STATUS.ALREADY_SUBSCRIBED, productId: input.productId });
    }
    return result(201, { status: API_STATUS.SUBSCRIBED, productId: input.productId });
}

module.exports = { subscribe: subscribe };
