'use strict';

/**
 * Builds the notification message for one subscriber: rendered HTML email (ISML),
 * plain-text fallback, optional SMS body and a product snapshot.
 */
var Template = require('dw/util/Template');
var HashMap = require('dw/util/HashMap');
var Resource = require('dw/web/Resource');
var StringUtils = require('dw/util/StringUtils');
var Site = require('dw/system/Site');
var URLUtils = require('dw/web/URLUtils');

var TEMPLATE = 'backinstock/email/backInStock';

function formatPrice(product) {
    var price = product.getPriceModel().getPrice();
    return price && price.isAvailable() ? StringUtils.formatMoney(price) : null;
}

function imageUrl(product) {
    var image = product.getImage('large', 0) || product.getImage('medium', 0);
    return image ? image.getAbsURL().toString() : null;
}

function variationLabel(product) {
    if (!product.isVariant()) return null;
    var model = product.getVariationModel();
    var parts = [];
    var attrs = model.getProductVariationAttributes().iterator();
    while (attrs.hasNext()) {
        var attr = attrs.next();
        var value = model.getVariationValue(product, attr);
        if (value) parts.push(attr.getDisplayName() + ': ' + value.getDisplayValue());
    }
    return parts.length ? parts.join(' · ') : null;
}

/**
 * @param {Object} subscriber - entry from the SKU's subscribers array
 * @param {dw.catalog.Product} product
 * @param {Object} opts - {ats, masterId, idempotencyKey}
 */
function build(subscriber, product, opts) {
    var brandName = Resource.msg('brand.name', 'backinstock', null);
    var productName = product.getName() || product.getID();
    // Absolute PDP URL on the instance (respects the site's hostname alias and URL rules).
    var productUrl = URLUtils.abs('Product-Show', 'pid', product.getID()).toString();

    var model = {
        brandName: brandName,
        productName: productName,
        productId: product.getID(),
        variation: variationLabel(product),
        price: formatPrice(product),
        imageUrl: imageUrl(product),
        productUrl: productUrl,
        year: new Date().getFullYear()
    };

    var subject = Resource.msgf('email.subject', 'backinstock', null, productName);
    var params = new HashMap();
    params.put('model', model);
    params.put('subject', subject);
    var html = new Template(TEMPLATE).render(params).getText();

    var hasSms = Boolean(subscriber.phone && subscriber.smsConsent);

    return {
        idempotencyKey: opts.idempotencyKey,
        eventType: 'product.back_in_stock',
        occurredAt: new Date().toISOString(),
        siteId: Site.getCurrent().getID(),
        product: {
            sku: product.getID(),
            masterId: opts.masterId || null,
            name: productName,
            variation: model.variation,
            price: model.price,
            imageUrl: model.imageUrl,
            url: productUrl,
            availableToSell: opts.ats
        },
        channels: hasSms ? ['email', 'sms'] : ['email'],
        email: {
            to: subscriber.email,
            subject: subject,
            html: html,
            text: Resource.msgf('email.text', 'backinstock', null, productName, productUrl)
        },
        sms: hasSms
            ? { to: subscriber.phone, body: Resource.msgf('sms.text', 'backinstock', null, brandName, productName, productUrl) }
            : null
    };
}

module.exports = { build: build };
