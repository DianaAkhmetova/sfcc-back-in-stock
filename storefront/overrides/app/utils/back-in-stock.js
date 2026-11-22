/*
 * Back-In-Stock waitlist helpers (framework-free so they are trivially unit-testable).
 */
import {isValidEmail} from '@salesforce/retail-react-app/app/utils/email-utils'

export const MAX_EMAIL_LENGTH = 254 // RFC 5321 path limit
const STORAGE_KEY = 'bis:subscriptions'
const STORAGE_TTL_MS = 1000 * 60 * 60 * 24 * 90 // forget local "already on list" hint after 90 days

/**
 * Resolve the exact orderable unit (SKU) the shopper wants to be notified about.
 *
 * Inventory in SFCC lives on the orderable product, never on a master/variation group, so
 * we must only ever subscribe a concrete SKU:
 *  - variant selected            -> variant.productId
 *  - PDP already loaded a variant -> product.id
 *  - standard item / bundle       -> product.id
 *  - master/variation group with incomplete selection -> null (shopper must pick options first)
 *  - selected combination does not exist in the catalog -> null (nothing to restock)
 *
 * @returns {{sku: string, masterId: (string|undefined)} | null}
 */
export const resolveWaitlistTarget = (product, variant) => {
    if (!product) return null
    const type = product.type || {}
    if (type.set) return null // sets have no inventory of their own; children are handled individually

    const masterId =
        product.master?.masterId || (type.master || type.variationGroup ? product.id : undefined)

    if (variant?.productId) return {sku: variant.productId, masterId}
    if (type.variant) return {sku: product.id, masterId}
    if (type.item || type.bundle) return {sku: product.id, masterId: undefined}
    return null
}

export const normalizeEmail = (email = '') => email.trim().toLowerCase()

/** @returns {null | 'required' | 'too_long' | 'invalid_format'} */
export const getEmailError = (email) => {
    const value = normalizeEmail(email)
    if (!value) return 'required'
    if (value.length > MAX_EMAIL_LENGTH) return 'too_long'
    if (!isValidEmail(value)) return 'invalid_format'
    return null
}

/**
 * Normalize a phone number to E.164 (+<country><number>). We require an explicit country code:
 * guessing it from the locale would silently text the wrong number.
 * "00" international prefix is converted to "+". Formatting characters are dropped.
 */
export const normalizePhone = (phone = '') => {
    let value = phone.trim().replace(/[\s().\-/]/g, '')
    if (value.startsWith('00')) value = '+' + value.slice(2)
    return value
}

/** Phone is optional. @returns {null | 'missing_country_code' | 'invalid_format'} */
export const getPhoneError = (phone) => {
    const value = normalizePhone(phone)
    if (!value) return null
    if (!value.startsWith('+')) return 'missing_country_code'
    if (!E164_REGEX.test(value)) return 'invalid_format'
    return null
}
const E164_REGEX = /^\+[1-9]\d{6,14}$/

export const buildEndpoint = (template, {siteId}) =>
    template.replace('{siteId}', encodeURIComponent(siteId || ''))

/** Parse Retry-After (seconds or HTTP date) into seconds, clamped to [1, 3600]. */
export const parseRetryAfter = (header, now = Date.now()) => {
    if (!header) return 30
    const seconds = Number(header)
    const value = Number.isFinite(seconds)
        ? seconds
        : Math.ceil((new Date(header).getTime() - now) / 1000)
    if (!Number.isFinite(value)) return 30
    return Math.min(Math.max(Math.round(value), 1), 3600)
}

// ---------------------------------------------------------------------------------------------
// Local "you're already on the list" hint. Per-browser convenience only: the server is the
// source of truth (and dedupes). Stores SKU -> timestamp, never the email address.
// ---------------------------------------------------------------------------------------------
const readStore = () => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        return raw ? JSON.parse(raw) || {} : {}
    } catch (e) {
        return {}
    }
}

export const rememberSubscription = (sku) => {
    try {
        const store = readStore()
        store[sku] = Date.now()
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    } catch (e) {
        // storage unavailable (private mode, quota) - non-critical
    }
}

export const hasRememberedSubscription = (sku, now = Date.now()) => {
    const ts = readStore()[sku]
    return Boolean(ts && now - ts < STORAGE_TTL_MS)
}
