'use strict';

/**
 * Data access for BackInStockProduct (one custom object per SKU, key = SKU).
 * Subscribers live in `custom.subscribers` as a JSON array (FIFO = array order):
 *   [{email, phone, smsConsent, status, attempts, subscribedAt, lastError}]
 */
var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Transaction = require('dw/system/Transaction');
var constants = require('*/cartridge/scripts/backinstock/constants');

var TYPE = constants.CUSTOM_OBJECT_TYPE;

function readSubscribers(co) {
    if (!co || !co.custom.subscribers) return [];
    try {
        return JSON.parse(co.custom.subscribers) || [];
    } catch (e) {
        return [];
    }
}

function writeSubscribers(co, list) {
    co.custom.subscribers = JSON.stringify(list);
}

/**
 * Add a subscriber to the SKU's waitlist (creates the SKU object on first signup).
 * If the email is already on the list, nothing is written.
 * @returns {'added'|'exists'}
 */
function addSubscriber(sku, masterId, subscriber) {
    var co = CustomObjectMgr.getCustomObject(TYPE, sku);
    var list = readSubscribers(co);
    var exists = list.some(function (s) { return s.email === subscriber.email; });
    if (exists) return 'exists';

    Transaction.wrap(function () {
        if (!co) co = CustomObjectMgr.createCustomObject(TYPE, sku);
        if (masterId) co.custom.masterProductID = masterId;
        list.push(subscriber);
        writeSubscribers(co, list);
    });
    return 'added';
}

/** Persist the (modified) subscriber array of a SKU object. */
function save(co, list) {
    Transaction.wrap(function () {
        writeSubscribers(co, list);
    });
}

/** Delete a SKU waitlist object. */
function remove(co) {
    Transaction.wrap(function () {
        CustomObjectMgr.remove(co);
    });
}

/** All SKU waitlist objects. Caller must close() the iterator. */
function getAll() {
    return CustomObjectMgr.getAllCustomObjects(TYPE);
}

module.exports = {
    readSubscribers: readSubscribers,
    addSubscriber: addSubscriber,
    save: save,
    remove: remove,
    getAll: getAll
};
