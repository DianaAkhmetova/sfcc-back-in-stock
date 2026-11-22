'use strict';

module.exports = {
    /** One custom object per SKU; subscribers are stored as a JSON array on it. */
    CUSTOM_OBJECT_TYPE: 'BackInStockProduct',

    /**
     * Per-subscriber status (inside the JSON array):
     *   PENDING - waiting. A temporary delivery error keeps it PENDING (attempts + 1); the next run retries.
     *   FAILED  - permanent error, or MaxAttempts temporary errors.
     * Notified subscribers are removed from the array (production) or left PENDING (job TestMode).
     */
    STATUS: {
        PENDING: 'PENDING',
        FAILED: 'FAILED'
    },

    API_STATUS: {
        SUBSCRIBED: 'subscribed',
        ALREADY_SUBSCRIBED: 'already_subscribed',
        INVALID: 'invalid',
        ERROR: 'error'
    },

    LOG_CATEGORY: 'backinstock',
    WEBHOOK_SERVICE_ID: 'backinstock.webhook.notify'
};
