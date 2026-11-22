/*
 * Back-In-Stock "Notify Me" component. Rendered by the overridden ProductView in place of the
 * "Add to Cart" button when the resolved SKU is out of stock.
 *
 *  placement="inline" -> full form (desktop action area)
 *  placement="sticky" -> compact button opening the form in a modal (mobile sticky footer)
 */
import React, {useEffect, useId, useRef, useState} from 'react'
import PropTypes from 'prop-types'
import {useIntl, FormattedMessage} from 'react-intl'
import {
    Alert,
    AlertDescription,
    AlertIcon,
    Box,
    Button,
    Checkbox,
    FormControl,
    FormErrorMessage,
    FormLabel,
    Heading,
    Input,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalOverlay,
    Stack,
    Text,
    useDisclosure
} from '@salesforce/retail-react-app/app/components/shared/ui'
import {useCurrentCustomer} from '@salesforce/retail-react-app/app/hooks/use-current-customer'
import {STATUS, useBackInStockSubscription} from '../../hooks/use-back-in-stock-subscription'
import {getEmailError, getPhoneError, hasRememberedSubscription} from '../../utils/back-in-stock'

const PHONE_ERROR_MESSAGES = {
    missing_country_code: {
        id: 'back_in_stock.error.phone_country_code',
        defaultMessage: 'Please include your country code, starting with + (e.g. +1 555 123 4567).'
    },
    invalid_format: {
        id: 'back_in_stock.error.phone_invalid',
        defaultMessage: 'Please enter a valid mobile number.'
    }
}

const EMAIL_ERROR_MESSAGES = {
    required: {
        id: 'back_in_stock.error.email_required',
        defaultMessage: 'Please enter your email address.'
    },
    too_long: {
        id: 'back_in_stock.error.email_too_long',
        defaultMessage: 'This email address is too long.'
    },
    invalid_format: {
        id: 'back_in_stock.error.email_invalid',
        defaultMessage: 'Please enter a valid email address.'
    }
}

const ResultAlert = ({status, retryAfter, productName, withSms = false}) => {
    const map = {
        [STATUS.SUBSCRIBED]: {
            type: 'success',
            msg: withSms
                ? {
                      id: 'back_in_stock.result.subscribed_sms',
                      defaultMessage:
                          "You're on the list! We'll email and text you as soon as {productName} is back in stock."
                  }
                : {
                      id: 'back_in_stock.result.subscribed',
                      defaultMessage:
                          "You're on the list! We'll email you as soon as {productName} is back in stock."
                  }
        },
        [STATUS.ALREADY_SUBSCRIBED]: {
            type: 'info',
            msg: {
                id: 'back_in_stock.result.already_subscribed',
                defaultMessage:
                    "You're already on the waitlist for this item. We'll email you when it's back."
            }
        },
        [STATUS.RATE_LIMITED]: {
            type: 'warning',
            msg: {
                id: 'back_in_stock.result.rate_limited',
                defaultMessage:
                    'Too many requests. Please try again in {seconds, plural, one {# second} other {# seconds}}.'
            }
        },
        [STATUS.INVALID]: {
            type: 'error',
            msg: {
                id: 'back_in_stock.result.invalid',
                defaultMessage: 'Please check your details and try again.'
            }
        },
        [STATUS.ERROR]: {
            type: 'error',
            msg: {
                id: 'back_in_stock.result.error',
                defaultMessage: 'Something went wrong on our side. Please try again in a moment.'
            }
        }
    }
    const entry = map[status]
    if (!entry) return null
    return (
        <Alert status={entry.type} borderRadius="base" data-testid={`back-in-stock-${status}`}>
            <AlertIcon />
            <AlertDescription>
                <FormattedMessage {...entry.msg} values={{productName, seconds: retryAfter}} />
            </AlertDescription>
        </Alert>
    )
}

ResultAlert.propTypes = {
    withSms: PropTypes.bool,
    status: PropTypes.string,
    retryAfter: PropTypes.number,
    productName: PropTypes.string
}

const DONE_STATUSES = [STATUS.SUBSCRIBED, STATUS.ALREADY_SUBSCRIBED]

export const NotifyMeForm = ({sku, masterId, productName, focusOnMount = false, onDone}) => {
    const intl = useIntl()
    const inputId = useId()
    const phoneId = useId()
    const inputRef = useRef(null)
    const phoneRef = useRef(null)
    const {data: customer} = useCurrentCustomer()
    const {status, retryAfter, field, isSubmitting, subscribe, reset} = useBackInStockSubscription()
    const [email, setEmail] = useState('')
    const [touched, setTouched] = useState(false)
    const [phone, setPhone] = useState('')
    const [phoneTouched, setPhoneTouched] = useState(false)
    const [smsConsent, setSmsConsent] = useState(false)
    const [submitAttempted, setSubmitAttempted] = useState(false)
    const [remembered, setRemembered] = useState(false)

    // Prefill for registered shoppers (only if the shopper hasn't typed anything yet).
    // Phone is deliberately NOT prefilled: SMS needs a fresh, explicit opt-in per signup.
    useEffect(() => {
        if (customer?.isRegistered && customer?.email) setEmail((e) => e || customer.email)
    }, [customer?.isRegistered, customer?.email])

    // localStorage is client-only: read after mount to avoid hydration mismatches.
    useEffect(() => {
        setRemembered(hasRememberedSubscription(sku))
        reset()
    }, [sku])

    useEffect(() => {
        if (focusOnMount) inputRef.current?.focus()
    }, [focusOnMount])

    const emailError = getEmailError(email)
    const showEmailError =
        (touched && emailError) || (status === STATUS.INVALID && field === 'email')
    const hasPhone = phone.trim() !== ''
    const phoneError = getPhoneError(phone)
    const showPhoneError =
        (phoneTouched && phoneError) || (status === STATUS.INVALID && field === 'phone')
    const consentError = hasPhone && !smsConsent
    const showConsentError =
        (submitAttempted && consentError) || (status === STATUS.INVALID && field === 'smsConsent')
    const isDone = DONE_STATUSES.includes(status)
    const isRateLimited = status === STATUS.RATE_LIMITED && retryAfter > 0

    const onSubmit = async (e) => {
        e.preventDefault()
        setTouched(true)
        setPhoneTouched(true)
        setSubmitAttempted(true)
        if (emailError || phoneError || consentError || isSubmitting || isRateLimited) {
            if (emailError) inputRef.current?.focus()
            else if (phoneError) phoneRef.current?.focus()
            return
        }
        const result = await subscribe({
            email,
            phone: hasPhone ? phone : '',
            smsConsent: hasPhone && smsConsent,
            sku,
            masterId
        })
        if (DONE_STATUSES.includes(result)) onDone?.(result)
    }

    const resetForm = () => {
        reset()
        setEmail('')
        setPhone('')
        setSmsConsent(false)
        setTouched(false)
        setPhoneTouched(false)
        setSubmitAttempted(false)
    }

    if (isDone) {
        return (
            <Stack spacing={3} role="status" aria-live="polite">
                <ResultAlert status={status} productName={productName} withSms={hasPhone} />

                <Button variant="link" size="sm" alignSelf="flex-start" onClick={resetForm}>
                    <FormattedMessage
                        id="back_in_stock.button.different_contact"
                        defaultMessage="Use different contact details"
                    />
                </Button>
            </Stack>
        )
    }

    return (
        <Box as="form" onSubmit={onSubmit} noValidate data-testid="back-in-stock-form">
            <Stack spacing={3}>
                {remembered && status === STATUS.IDLE && (
                    <Text fontSize="sm" color="gray.600">
                        <FormattedMessage
                            id="back_in_stock.hint.remembered"
                            defaultMessage="You've already asked to be notified about this item on this device."
                        />
                    </Text>
                )}
                <FormControl isInvalid={Boolean(showEmailError)} isRequired>
                    <FormLabel htmlFor={inputId} fontSize="sm">
                        <FormattedMessage
                            id="back_in_stock.label.email"
                            defaultMessage="Email address"
                        />
                    </FormLabel>
                    <Input
                        id={inputId}
                        ref={inputRef}
                        type="email"
                        name="email"
                        inputMode="email"
                        autoComplete="email"
                        maxLength={254}
                        value={email}
                        isDisabled={isSubmitting}
                        placeholder={intl.formatMessage({
                            id: 'back_in_stock.placeholder.email',
                            defaultMessage: 'you@example.com'
                        })}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => setTouched(true)}
                    />
                    <FormErrorMessage>
                        <FormattedMessage
                            {...EMAIL_ERROR_MESSAGES[emailError || 'invalid_format']}
                        />
                    </FormErrorMessage>
                </FormControl>

                <FormControl isInvalid={Boolean(showPhoneError)}>
                    <FormLabel htmlFor={phoneId} fontSize="sm">
                        <FormattedMessage
                            id="back_in_stock.label.phone"
                            defaultMessage="Mobile number for SMS (optional)"
                        />
                    </FormLabel>
                    <Input
                        id={phoneId}
                        ref={phoneRef}
                        type="tel"
                        name="phone"
                        inputMode="tel"
                        autoComplete="tel"
                        maxLength={20}
                        value={phone}
                        isDisabled={isSubmitting}
                        placeholder={intl.formatMessage({
                            id: 'back_in_stock.placeholder.phone',
                            defaultMessage: '+1 555 123 4567'
                        })}
                        onChange={(e) => setPhone(e.target.value)}
                        onBlur={() => setPhoneTouched(true)}
                    />
                    <FormErrorMessage>
                        <FormattedMessage
                            {...PHONE_ERROR_MESSAGES[phoneError || 'invalid_format']}
                        />
                    </FormErrorMessage>
                </FormControl>

                {hasPhone && (
                    <FormControl isInvalid={Boolean(showConsentError)}>
                        <Checkbox
                            isChecked={smsConsent}
                            isDisabled={isSubmitting}
                            onChange={(e) => setSmsConsent(e.target.checked)}
                            size="sm"
                            alignItems="flex-start"
                        >
                            <Text as="span" fontSize="xs">
                                <FormattedMessage
                                    id="back_in_stock.label.sms_consent"
                                    defaultMessage="I agree to receive a one-time text message when this item is back in stock. Message and data rates may apply."
                                />
                            </Text>
                        </Checkbox>
                        <FormErrorMessage>
                            <FormattedMessage
                                id="back_in_stock.error.sms_consent"
                                defaultMessage="Please confirm you agree to receive a text message, or remove the phone number."
                            />
                        </FormErrorMessage>
                    </FormControl>
                )}

                <Box role="status" aria-live="polite">
                    {status !== STATUS.IDLE && status !== STATUS.SUBMITTING && (
                        <ResultAlert
                            status={status}
                            retryAfter={retryAfter}
                            productName={productName}
                            withSms={hasPhone}
                        />
                    )}
                </Box>

                <Button
                    type="submit"
                    width="100%"
                    variant="solid"
                    isLoading={isSubmitting}
                    isDisabled={isRateLimited}
                    loadingText={intl.formatMessage({
                        id: 'back_in_stock.button.submitting',
                        defaultMessage: 'Signing you up…'
                    })}
                    data-testid="back-in-stock-submit"
                >
                    <FormattedMessage
                        id="back_in_stock.button.notify_me"
                        defaultMessage="Notify Me"
                    />
                </Button>
                <Text fontSize="xs" color="gray.600">
                    <FormattedMessage
                        id="back_in_stock.legal"
                        defaultMessage="We'll only use your email to tell you when this item is back in stock."
                    />
                </Text>
            </Stack>
        </Box>
    )
}

NotifyMeForm.propTypes = {
    sku: PropTypes.string.isRequired,
    masterId: PropTypes.string,
    productName: PropTypes.string,
    focusOnMount: PropTypes.bool,
    onDone: PropTypes.func
}

const Intro = () => (
    <Stack spacing={1} marginBottom={3}>
        <Heading as="h3" fontSize="md">
            <FormattedMessage
                id="back_in_stock.heading"
                defaultMessage="Get notified when it's back"
            />
        </Heading>
        <Text fontSize="sm" color="gray.700">
            <FormattedMessage
                id="back_in_stock.description"
                defaultMessage="This item is currently out of stock. Leave your email and we'll let you know as soon as it's available."
            />
        </Text>
    </Stack>
)

const BackInStockNotify = ({placement = 'inline', ...formProps}) => {
    const {isOpen, onOpen, onClose} = useDisclosure()
    const intl = useIntl()

    if (placement === 'sticky') {
        return (
            <>
                <Button
                    width="100%"
                    variant="solid"
                    onClick={onOpen}
                    data-testid="back-in-stock-open"
                >
                    <FormattedMessage
                        id="back_in_stock.button.notify_me_when_available"
                        defaultMessage="Notify Me When Available"
                    />
                </Button>
                <Modal isOpen={isOpen} onClose={onClose} size="md" isCentered>
                    <ModalOverlay />
                    <ModalContent
                        margin={4}
                        aria-label={intl.formatMessage({
                            id: 'back_in_stock.heading',
                            defaultMessage: "Get notified when it's back"
                        })}
                    >
                        <ModalHeader paddingBottom={0}>{formProps.productName}</ModalHeader>
                        <ModalCloseButton />
                        <ModalBody paddingBottom={6}>
                            <Intro />
                            <NotifyMeForm {...formProps} focusOnMount />
                        </ModalBody>
                    </ModalContent>
                </Modal>
            </>
        )
    }

    return (
        <Box
            width="100%"
            marginBottom={4}
            padding={4}
            borderWidth="1px"
            borderColor="gray.200"
            borderRadius="base"
            data-testid="back-in-stock-inline"
        >
            <Intro />
            <NotifyMeForm {...formProps} />
        </Box>
    )
}

BackInStockNotify.propTypes = {
    placement: PropTypes.oneOf(['inline', 'sticky']),
    sku: PropTypes.string.isRequired,
    masterId: PropTypes.string,
    productName: PropTypes.string
}

export default BackInStockNotify
