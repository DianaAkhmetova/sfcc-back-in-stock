'use strict';

/**
 * SKU resolution and inventory snapshot.
 *
 * Inventory in SFCC is held per orderable product (variant / standard product / bundle), never on
 * a master or variation group. A waitlist entry is therefore only meaningful for a concrete SKU.
 */
var ProductMgr = require('dw/catalog/ProductMgr');

/**
 * @param {string} productId
 * @returns {{product: dw.catalog.Product, masterId: string|null} | null}
 *          null = unknown/offline product, or a master/variation group/set (no own inventory)
 */
function resolveSku(productId) {
    var product = ProductMgr.getProduct(productId);
    if (!product || !product.isOnline() || !product.isAssignedToSiteCatalog() ||
        product.isMaster() || product.isVariationGroup() || product.isProductSet()) {
        return null;
    }
    var masterId = null;
    if (product.isVariant()) {
        var master = product.getMasterProduct();
        masterId = master ? master.getID() : null;
    }
    return { product: product, masterId: masterId };
}

/** Diagnostic: why resolveSku() returned null (for job logs). */
function whyUnresolved(productId) {
    var product = ProductMgr.getProduct(productId);
    if (!product) return 'NOT_FOUND';
    if (!product.isOnline()) return 'OFFLINE';
    if (!product.isAssignedToSiteCatalog()) return 'NOT_IN_SITE_CATALOG';
    if (product.isMaster() || product.isVariationGroup()) return 'MASTER_NOT_SKU';
    if (product.isProductSet()) return 'PRODUCT_SET';
    return 'UNKNOWN';
}

/**
 * Inventory snapshot from the site's assigned inventory list.
 * @param {dw.catalog.Product} product
 * @returns {{ats: number|null, perpetual: boolean, orderable: boolean, hasRecord: boolean}}
 *          ats === null means perpetual (unlimited) inventory.
 */
function getSnapshot(product) {
    var availabilityModel = product.getAvailabilityModel();
    var record = availabilityModel.getInventoryRecord();
    if (!record) {
        // No record = never stocked on this site's inventory list -> treat as out of stock.
        return { ats: 0, perpetual: false, orderable: false, hasRecord: false };
    }
    if (record.isPerpetual()) {
        return { ats: null, perpetual: true, orderable: true, hasRecord: true };
    }
    var atsQuantity = record.getATS();
    var ats = atsQuantity && atsQuantity.isAvailable() ? atsQuantity.getValue() : 0;
    return {
        ats: ats,
        perpetual: false,
        orderable: availabilityModel.isOrderable(1),
        hasRecord: true
    };
}

module.exports = {
    resolveSku: resolveSku,
    whyUnresolved: whyUnresolved,
    getSnapshot: getSnapshot
};
