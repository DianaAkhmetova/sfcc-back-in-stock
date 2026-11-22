'use strict';

/**
 * Custom SCAPI endpoint:
 *   POST /custom/back-in-stock/v1/organizations/{organizationId}/subscriptions?siteId={siteId}
 *
 * Errors use RESTResponseMgr.createError (problem details). The machine-readable reason is in
 * `type`: ".../custom-errors/<status>[.<field>]", e.g. ".../custom-errors/invalid.email".
 */
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var Logger = require('dw/system/Logger');
var subscriptionService = require('*/cartridge/scripts/backinstock/subscriptionService');

var log = Logger.getLogger('backinstock', 'api');

function renderError(httpStatus, status, field, detail) {
    var type = field ? status + '.' + field : status;
    RESTResponseMgr.createError(httpStatus, type, status, detail || null).render();
}

exports.createSubscription = function () {
    var body;
    try {
        body = JSON.parse(request.httpParameterMap.requestBodyAsString || '{}');
    } catch (e) {
        renderError(400, 'invalid', 'body', 'Request body is not valid JSON.');
        return;
    }

    var outcome;
    try {
        outcome = subscriptionService.subscribe(body);
    } catch (e) {
        log.error('createSubscription failed: {0}', e.message);
        renderError(500, 'error', null, 'Please try again later.');
        return;
    }

    if (outcome.httpStatus < 300) {
        RESTResponseMgr.createSuccess(outcome.body, outcome.httpStatus).render();
    } else {
        renderError(outcome.httpStatus, outcome.body.status, outcome.body.field, outcome.body.detail);
    }
};
exports.createSubscription.public = true;
