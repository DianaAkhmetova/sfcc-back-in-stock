'use strict';

/**
 * Job step custom.BackInStock.ProcessWaitlist (site context, scheduled hourly).
 *
 * For every SKU waitlist object:
 *   1. Check inventory (ATS) of the SKU.
 *   2. Below MinimumStockThreshold -> skip. Otherwise notify the first
 *      floor(ATS x NotificationMultiplier) waiting subscribers (FIFO = array order).
 *   3. Per subscriber: sent on success; temporary failure keeps it PENDING (the next hourly
 *      run retries); FAILED on permanent failure or after MaxAttempts.
 *   4. Production: a subscriber is removed from the array once notified (an empty SKU object is
 *      deleted). TestMode: subscribers are kept unchanged, so the next run sends to them again.
 *   5. Provider throttling (429) or circuit breaker open -> stop the run; next run continues.
 */
var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var constants = require('*/cartridge/scripts/backinstock/constants');
var repository = require('*/cartridge/scripts/backinstock/subscriptionRepository');
var productAvailability = require('*/cartridge/scripts/backinstock/productAvailability');
var replenishment = require('*/cartridge/scripts/backinstock/lib/replenishment');
var messageBuilder = require('*/cartridge/scripts/backinstock/notification/messageBuilder');
var providers = require('*/cartridge/scripts/backinstock/notification/providers');

var STATUS = constants.STATUS;
var log = Logger.getLogger(constants.LOG_CATEGORY, 'job');

function num(value, fallback) {
    var n = Number(value);
    return value === null || value === undefined || value === '' || isNaN(n) ? fallback : n;
}

function readConfig(params) {
    return {
        threshold: Math.max(1, num(params.MinimumStockThreshold, 30)),
        notificationMultiplier: Math.max(0.1, num(params.NotificationMultiplier, 2)),
        maxAttempts: Math.max(1, num(params.MaxAttempts, 5)),
        testMode: params.TestMode === true || params.TestMode === 'true',
        provider: params.DeliveryProvider || 'webhook'
    };
}

/**
 * Update the subscriber entry from the delivery result.
 * @returns {null|'THROTTLED'|'CIRCUIT_OPEN'} run-level stop signal
 */
function applyResult(entry, result, cfg, now, stats) {
    var kind = replenishment.classifyDeliveryResult(result);

    if (kind === 'DELIVERED') {
        // No status change: the caller removes the subscriber (production) or keeps it (TestMode).
        stats.notified++;
        return null;
    }
    if (kind === 'THROTTLED' || kind === 'CIRCUIT_OPEN') {
        // Provider-wide problem (429 / circuit breaker): not this shopper's fault. Leave PENDING
        // without counting an attempt and stop the run; the next run continues.
        entry.lastError = kind + (result.httpStatus ? ' (HTTP ' + result.httpStatus + ')' : '');
        stats.throttled++;
        return kind;
    }

    entry.attempts = (entry.attempts || 0) + 1;
    entry.lastError = (result.httpStatus ? 'HTTP ' + result.httpStatus + ': ' : '') +
        String(result.errorMessage || 'error').substring(0, 500);
    if (kind === 'PERMANENT_FAILURE' || entry.attempts >= cfg.maxAttempts) {
        entry.status = STATUS.FAILED;
        stats.failed++;
    } else {
        stats.retryNextRun++; // stays PENDING
    }
    return null;
}

exports.execute = function (params) {
    var now = new Date();
    var cfg = readConfig(params);
    var provider = providers.get(cfg.provider);
    var stats = { skus: 0, notified: 0, retryNextRun: 0, failed: 0, throttled: 0, skippedSkus: 0, removedSkus: 0, skipped: {} };
    var stopReason = null;

    var it = repository.getAll();
    try {
        while (it.hasNext() && !stopReason) {
            var co = it.next();
            var sku = co.custom.productID;
            stats.skus++;

            var resolved = productAvailability.resolveSku(sku);
            if (!resolved) {
                stats.skipped[sku] = productAvailability.whyUnresolved(sku);
                log.warn('sku={0} skipped: {1}', sku, stats.skipped[sku]);
                stats.skippedSkus++;
                continue;
            }

            var snapshot = productAvailability.getSnapshot(resolved.product);
            var decision = replenishment.computeNotificationQuota({
                ats: snapshot.perpetual ? null : snapshot.ats,
                threshold: cfg.threshold,
                notificationMultiplier: cfg.notificationMultiplier
            });
            log.info('sku={0} ats={1} decision={2} quota={3}', sku, snapshot.ats, decision.reason, decision.quota);
            if (!decision.eligible || !snapshot.orderable) {
                // Shown in the job status message, so the reason is visible without log settings.
                stats.skipped[sku] = (decision.eligible ? 'NOT_ORDERABLE' : decision.reason) +
                    ' (ats=' + snapshot.ats + ', threshold=' + cfg.threshold +
                    (snapshot.hasRecord ? '' : ', no inventory record in site inventory list') + ')';
                log.warn('sku={0} skipped: {1}', sku, stats.skipped[sku]);
                stats.skippedSkus++;
                continue;
            }

            var list = repository.readSubscribers(co);
            var waiting = list.filter(function (s) { return s.status === STATUS.PENDING; });
            var sent = 0;
            for (var i = 0; i < waiting.length && sent < decision.quota && !stopReason; i++) {
                var entry = waiting[i];

                var result;
                try {
                    var message = messageBuilder.build(entry, resolved.product, {
                        ats: snapshot.ats,
                        masterId: co.custom.masterProductID,
                        // Same key on retries -> the provider can drop duplicates.
                        idempotencyKey: sku + ':' + entry.email + ':' + entry.subscribedAt
                    });
                    result = provider.send(message);
                } catch (e) {
                    result = { ok: false, httpStatus: 0, errorMessage: e.message };
                }

                stopReason = applyResult(entry, result, cfg, now, stats);
                if (result.ok) {
                    sent++;
                    // Production: notified -> removed from the waitlist. TestMode: keep it as is.
                    if (!cfg.testMode) list.splice(list.indexOf(entry), 1);
                } else {
                    log.warn('sku={0} delivery via {1} failed (attempt {2}): {3}', sku, cfg.provider, entry.attempts || 0, entry.lastError);
                }
                // Save after every send so a crash never causes a second email to the same shopper.
                repository.save(co, list);
            }

            // Everyone on this SKU's waitlist was notified: delete the object.
            if (!cfg.testMode && list.length === 0) {
                repository.remove(co);
                stats.removedSkus++;
            }
        }
    } finally {
        it.close();
    }

    var summary = JSON.stringify({ provider: cfg.provider, stats: stats, stopReason: stopReason });
    log.info('ProcessWaitlist finished: {0}', summary);

    if (stopReason) return new Status(Status.OK, 'PROVIDER_' + stopReason, summary);
    return new Status(Status.OK, 'OK', summary);
};
