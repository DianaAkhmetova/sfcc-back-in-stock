/*
 * useBackInStockSubscription - calls the Back-In-Stock custom SCAPI API (cartridge demo_backinstock).
 *
 *   POST {endpoint}  Authorization: Bearer <shopper SLAS token>
 *   body    : {productId, email, phone?, smsConsent}
 *   200/201 : {status: 'subscribed' | 'already_subscribed', productId}
 *   4xx/5xx : problem details, reason in the last segment of `type`:
 *             ".../custom-errors/invalid.email" -> status 'invalid', field 'email'
 */
import {useCallback, useEffect, useRef, useState} from 'react'
import {getConfig} from '@salesforce/pwa-kit-runtime/utils/ssr-config'
import {useAccessToken} from '@salesforce/commerce-sdk-react'
import useMultiSite from '@salesforce/retail-react-app/app/hooks/use-multi-site'
import {
    buildEndpoint,
    normalizeEmail,
    normalizePhone,
    parseRetryAfter,
    rememberSubscription
} from '../utils/back-in-stock'

export const STATUS = {
    IDLE: 'idle',
    SUBMITTING: 'submitting',
    SUBSCRIBED: 'subscribed',
    ALREADY_SUBSCRIBED: 'already_subscribed',
    INVALID: 'invalid',
    RATE_LIMITED: 'rate_limited',
    ERROR: 'error'
}

/** Map an HTTP response to {status, field}. */
const parseResponse = (httpStatus, body) => {
    if (httpStatus === 200 || httpStatus === 201) {
        return {
            status:
                body?.status === STATUS.ALREADY_SUBSCRIBED
                    ? STATUS.ALREADY_SUBSCRIBED
                    : STATUS.SUBSCRIBED,
            field: null
        }
    }
    if (httpStatus === 429) return {status: STATUS.RATE_LIMITED, field: null}
    // Custom error type: ".../custom-errors/<status>[.<field>]"
    const reason = typeof body?.type === 'string' ? body.type.split('/').pop() : ''
    const [status, field] = reason.split('.')
    if (httpStatus === 400 || status === STATUS.INVALID) {
        return {status: STATUS.INVALID, field: field || null}
    }
    return {status: STATUS.ERROR, field: null} // 401/403 (token), 5xx, network
}

export const useBackInStockSubscription = () => {
    const config = getConfig()?.app?.backInStock || {}
    const {site} = useMultiSite()
    const {getTokenWhenReady} = useAccessToken()
    const [state, setState] = useState({status: STATUS.IDLE, retryAfter: 0, field: null})
    const inFlight = useRef(false)
    const mounted = useRef(true)

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])

    // Count down the rate-limit window so the button re-enables itself.
    useEffect(() => {
        if (state.status !== STATUS.RATE_LIMITED || state.retryAfter <= 0) return undefined
        const t = setTimeout(() => {
            setState((s) =>
                s.status === STATUS.RATE_LIMITED ? {...s, retryAfter: s.retryAfter - 1} : s
            )
        }, 1000)
        return () => clearTimeout(t)
    }, [state.status, state.retryAfter])

    const reset = useCallback(() => setState({status: STATUS.IDLE, retryAfter: 0, field: null}), [])

    const subscribe = useCallback(
        async ({email, phone = '', smsConsent = false, sku}) => {
            if (inFlight.current) return null // double-click guard
            inFlight.current = true
            setState({status: STATUS.SUBMITTING, retryAfter: 0, field: null})

            const normalizedPhone = normalizePhone(phone)
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 8000)
            let result = {status: STATUS.ERROR, retryAfter: 0, field: null}

            try {
                const token = await getTokenWhenReady()
                const response = await fetch(buildEndpoint(config.endpoint, {siteId: site?.id}), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        productId: sku,
                        email: normalizeEmail(email),
                        phone: normalizedPhone || undefined,
                        smsConsent: Boolean(normalizedPhone && smsConsent)
                    }),
                    signal: controller.signal
                })
                let body = null
                try {
                    body = await response.json()
                } catch (e) {
                    body = null
                }
                const parsed = parseResponse(response.status, body)
                result = {
                    ...parsed,
                    retryAfter:
                        parsed.status === STATUS.RATE_LIMITED
                            ? parseRetryAfter(response.headers.get('Retry-After'))
                            : 0
                }
            } catch (e) {
                // network error or timeout -> generic error
            } finally {
                clearTimeout(timeout)
                inFlight.current = false
            }

            if (
                result.status === STATUS.SUBSCRIBED ||
                result.status === STATUS.ALREADY_SUBSCRIBED
            ) {
                rememberSubscription(sku)
            }
            if (mounted.current) setState(result)
            return result.status
        },
        [config.endpoint, config.timeoutMs, site?.id, getTokenWhenReady]
    )

    return {...state, isSubmitting: state.status === STATUS.SUBMITTING, subscribe, reset}
}

export default useBackInStockSubscription
