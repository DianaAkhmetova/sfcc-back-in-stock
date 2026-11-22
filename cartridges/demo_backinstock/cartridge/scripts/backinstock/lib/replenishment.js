'use strict';

/**
 * Pure decision logic for the waitlist job (no dw.* dependencies -> unit-testable in Node).
 */

/**
 * How many subscribers of one SKU may be notified in this run.
 *
 * Partial replenishment: notifying every subscriber when 5 units arrive for 500 shoppers
 * produces 495 disappointed clicks. Instead we notify in FIFO "waves" proportional to stock:
 *     quota = floor(ATS * notificationMultiplier)
 * Example: ATS 30, multiplier 2 -> the first 60 subscribers in line are notified.
 * Shoppers not reached stay PENDING and are picked up by the next run if stock remains.
 *
 * @param {Object} p
 * @param {number|null} p.ats - available-to-sell; null = perpetual/unlimited inventory
 * @param {number} p.threshold - minimum ATS before anyone is notified
 * @param {number} p.notificationMultiplier - e.g. 2 = notify 2 shoppers per unit (not everyone buys)
 * @returns {{eligible: boolean, quota: number, reason: string}}
 */
function computeNotificationQuota(p) {
    if (p.ats === null) {
        // Perpetual inventory: always in stock -> everyone waiting can be notified.
        return { eligible: true, quota: Infinity, reason: 'PERPETUAL' };
    }

    var ats = Math.max(0, Math.floor(p.ats || 0));
    if (ats <= 0) return { eligible: false, quota: 0, reason: 'OUT_OF_STOCK' };
    if (ats < p.threshold) return { eligible: false, quota: 0, reason: 'BELOW_THRESHOLD' };

    var multiplier = p.notificationMultiplier > 0 ? p.notificationMultiplier : 1;
    var quota = Math.max(1, Math.floor(ats * multiplier));
    return { eligible: true, quota: quota, reason: 'REPLENISHED' };
}

/**
 * Classify a delivery attempt result into what the job should do next.
 * @param {Object} r - {ok, httpStatus, unavailableReason}
 * @returns {'DELIVERED'|'RETRY'|'PERMANENT_FAILURE'|'THROTTLED'|'CIRCUIT_OPEN'}
 */
function classifyDeliveryResult(r) {
    if (r.ok) return 'DELIVERED';
    // SFCC service framework short-circuits without calling the provider:
    if (r.unavailableReason === 'RATE_LIMITED') return 'THROTTLED';
    // Circuit open, service disabled or misconfigured: provider-wide, not this shopper's fault.
    // Stop the run without counting an attempt against the subscriber.
    if (r.unavailableReason === 'CIRCUIT_BROKEN' || r.unavailableReason === 'DISABLED' ||
        r.unavailableReason === 'CONFIG_PROBLEM') {
        return 'CIRCUIT_OPEN';
    }
    if (r.unavailableReason === 'TIMEOUT') return 'RETRY';
    var s = r.httpStatus || 0;
    if (s === 429) return 'THROTTLED';
    if (s === 408 || s === 425 || s >= 500 || s === 0) return 'RETRY';
    // Other 4xx: our request is wrong (bad payload, auth). Retrying will not help.
    return 'PERMANENT_FAILURE';
}

module.exports = {
    computeNotificationQuota: computeNotificationQuota,
    classifyDeliveryResult: classifyDeliveryResult
};
