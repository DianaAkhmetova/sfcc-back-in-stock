# Back-In-Stock Waitlist (SFCC B2C + PWA Kit)

When a shopper lands on a product page and the item is out of stock, the "Add to Cart" button is replaced with a "Notify Me" form. The shopper leaves an email (and optionally a phone number for SMS), and an hourly job sends them a notification once the item is back in stock.

This is a demo. All the backend code lives in one cartridge, `demo_backinstock`, so it is easy to review and deploy. In a real project I would split it across the existing cartridges: the API, the job, the integration with the email/SMS provider and the shared logic each in their own cartridge.

## What's in the repo

| Folder | What it is |
|---|---|
| `storefront/` | PWA Kit 3.22 (retail-react-app, extensibility mode). My changes are in `storefront/overrides/`. |
| `cartridges/demo_backinstock/` | Custom SCAPI API, the waitlist job, notification providers and the email template. |
| `metadata/site_template/` | Site import: custom object type, webhook service, job schedule. |

## Setup

### 1. Sandbox config

Create `dw.json` in the repo root (it is git-ignored):

```json
{
  "hostname": "zzft-001.dx.commercecloud.salesforce.com",
  "username": "<BM user>",
  "password": "<BM password or WebDAV access key>",
  "code-version": "version1",
  "webhook-url": "https://webhook.site/<your-token>",
  "webhook-secret": "<any random string, used to sign webhook requests>"
}
```

### 2. Deploy the cartridge

```sh
npm install
npm run upload
```

In Business Manager:

1. **Administration > Sites > Manage Sites > RefArch > Settings**: add `demo_backinstock` to the cartridge path. Do the same for the Business Manager site, so the job step types are picked up.
2. **Administration > Site Development > Code Deployment**: re-activate the code version, so the platform reloads `steptypes.json`.

### 3. Import metadata

```sh
npm run zip:metadata
```

This creates two archives:

- `backinstock_site_template.zip`: custom object type, service and job. Required.
- `backinstock_demo_data.zip`: two SKUs with sample subscribers. Optional, for testing. Your email (from `dw.json`) is added as the first subscriber, so you receive the real email.

Upload and import them in **Administration > Site Development > Site Import & Export**.

### 4. Run the storefront

```sh
cd storefront
npm install
cp .env.example .env   # set PWA_SLAS_CLIENT_ID (SLAS public client with the c_consumer_rw scope)
npm start              # http://localhost:3000
```

Without `PWA_SLAS_CLIENT_ID` the storefront runs on Salesforce's public demo catalog, so the form renders but the API call is rejected.

Try `/product/701643037582M` (out-of-stock variant).

## How it works

### Frontend

I override `ProductView` and swap the cart button for the Notify Me form only when a **specific SKU** is out of stock: a simple product, a bundle, or a fully selected variant. If the shopper hasn't picked all the options yet, the normal "select options" behaviour stays.

- Desktop shows the form inline. On mobile, the sticky footer shows a "Notify Me When Available" button that opens the form in a modal.
- Email is required. The phone number is optional and must include a country code. If a phone is entered, the shopper has to tick an SMS consent checkbox.
- The request goes to the custom API through the PWA Kit proxy, with the shopper's SLAS token.

### API

`POST /custom/back-in-stock/v1/organizations/{org}/subscriptions?siteId=RefArch`

```json
{ "productId": "701643037582M", "email": "shopper@example.com", "phone": "+15551234567", "smsConsent": true }
```

- `201`: added to the waitlist. `200`: this email is already on the list, nothing changed.
- `400`: invalid input, or the product is a master/set/unknown product instead of a SKU. The reason is in the error `type`, e.g. `.../custom-errors/invalid.email`.

### Data model

One custom object per SKU, `BackInStockProduct`, with the SKU as its key. Subscribers are stored on it as a JSON array, in signup order:

```json
[{ "email": "...", "phone": "...", "smsConsent": true, "status": "PENDING", "attempts": 0, "subscribedAt": 1795233600000, "lastError": null }]
```

Status is `PENDING` (waiting) or `FAILED` (gave up). Once someone is notified, they are removed from the array, and when the array is empty the whole object is deleted.

### Job

`BackInStock-ProcessWaitlist` runs every hour. For each SKU on a waitlist it:

1. Checks the product still exists and is an orderable SKU.
2. Reads the available-to-sell quantity (ATS) from the site's inventory list.
3. Skips the SKU if ATS is below the threshold, otherwise decides how many people to notify (see [Minimum stock threshold](#minimum-stock-threshold) and [Partial replenishment](#partial-replenishment)).
4. Sends the notifications in signup order and saves the list after every send.

All settings are job step parameters, so a merchant can change them in Business Manager without a deploy:

| Parameter | Default | Meaning |
|---|---|---|
| `MinimumStockThreshold` | 30 | Don't notify anyone until ATS reaches this number. |
| `NotificationMultiplier` | 2 | How many people to notify per unit in stock. |
| `MaxAttempts` | 5 | Failed delivery attempts before a subscriber is marked `FAILED`. |
| `DeliveryProvider` | `webhook` | `webhook` (external REST API) or `sfccMail` (platform email). |
| `TestMode` | off | Keep subscribers after sending, so you can run the job again and get the email again. |

### Notifications

- **`webhook`** (default): a `POST` to an external messaging API through the SFCC Service Framework. Webhook.site plays the role of the provider. The body contains the rendered HTML email and, if there is a phone number, the SMS text.
- **`sfccMail`**: a real email through `dw.net.Mail`. Email only, no SMS. The sender address is `email.from` in `backinstock.properties`.

The email is an ISML template with the product image, the selected variation, the price and a "Shop now" button.

## Architectural decisions

**Custom SCAPI API instead of a controller.** The storefront is headless, so a SCAPI endpoint is the natural fit. It is secured by SLAS like every other shopper API, and I don't have to deal with CSRF or sessions.

**One custom object per SKU.** The job works per SKU anyway (one inventory check, then notify the people waiting), so keeping a SKU's subscribers together makes the job simple and lets a merchant see the whole waitlist for a product in one place.

**Job parameters instead of site preferences.** These settings belong to the job, so I kept them on the job step. A merchant can also run two configurations of the same job with different thresholds.

**Retries happen on the next hourly run.** The Service Framework already gives me a timeout, a rate limiter and a circuit breaker, but it doesn't retry. Rather than adding backoff timers, a temporary failure keeps the subscriber `PENDING` and increases `attempts`, so the next hourly run is the retry. That gives a natural one-hour gap between attempts with very little code.

**Delete after notifying.** A notification is a one-time thing. Once it's sent there is nothing to keep, and removing the entry means the list doesn't grow and the shopper can sign up again if the item sells out later. `TestMode` exists only so the flow can be tested repeatedly.

**Secure webhook calls.** The provider URL and signing secret are stored in the BM service credential, not in code. Every request goes over HTTPS and is signed with HMAC-SHA256 (`X-BIS-Signature` with an `X-BIS-Timestamp`), so the provider can check that the call really came from us and reject replays. The service log masks emails and phone numbers.

## Edge cases

### Minimum stock threshold

A restock of 1 or 2 units usually sells out before anyone opens the email, so notifying people about it only disappoints them. The job doesn't notify anyone for a SKU until its ATS reaches `MinimumStockThreshold` (30 by default). Below that, the subscribers simply keep waiting, and the job checks again on the next run.

The threshold is a job parameter, so a merchant can lower it for slow-moving or expensive items, or raise it for products that sell out in minutes.

### Partial replenishment

Even above the threshold, there can be far more people waiting than units in stock. If 500 people are waiting and 30 units arrive, notifying everyone means most of them click through to a product that is already gone.

So the job notifies only `floor(ATS x NotificationMultiplier)` people, oldest signups first. With 30 units and a multiplier of 2, the first 60 people get the email. The multiplier is above 1 because not everyone who gets the email buys. Everyone else stays on the list, and if stock is still there at the next run, the next group is notified.

Perpetual inventory counts as always in stock, so everyone waiting is notified.

### Variant-level SKUs

Inventory in SFCC lives on the orderable product, never on the master. So:

- The frontend only shows the form once a concrete variant is selected, and sends that variant's ID.
- The API rejects masters, variation groups, sets and unknown products with a `400`.
- If a product is deleted or taken offline later, the job skips it and logs the reason instead of failing.

### External API failures

| What happens | How it's handled |
|---|---|
| Provider is slow | Service timeout of 5 s. Counts as a temporary failure. |
| `5xx` or network error | Subscriber stays `PENDING`, `attempts + 1`, retried on the next run. |
| `429 Too Many Requests` | The run stops immediately, without counting an attempt against the shopper. The next run continues. |
| Too many failures in a row | The circuit breaker in the service profile opens (10 failures in 60 s), and the run stops. |
| Other `4xx` (our request is wrong) | Marked `FAILED` right away. Retrying won't help. |
| Platform rate limit | The service profile allows 120 calls per minute, so the job can't flood the provider. |

### No duplicate messages

- The list is saved after every single send. If the job dies halfway, the people already notified are not notified again.
- Every webhook call carries an `Idempotency-Key` (SKU + email + signup time) and is signed with HMAC (`X-BIS-Signature`, `X-BIS-Timestamp`), so a real provider can drop duplicates and verify the sender.
- SFCC never runs two instances of the same job at the same time.

### Duplicate and messy signups

- The same email on the same SKU is stored once. The second request returns `already_subscribed`.
- Emails are trimmed and lower-cased. Phone numbers are normalised to E.164 (spaces and dashes removed, `00` replaced with `+`), and a missing country code is rejected rather than guessed.
- SMS needs explicit consent. A phone number without consent is rejected by both the form and the API.
- The submit button is locked while a request is in flight, so double clicks don't send twice.
- If SCAPI returns `429`, the form shows a countdown and re-enables itself.

### Product comes back while the page is open

The form appears only when the PDP data says the SKU is out of stock. If stock comes back between page load and submit, the subscription is still stored, and the next job run notifies the shopper straight away.

## Testing

Without a SLAS client the API can't be called with a real token, but the whole job can be tested with the demo data:

1. Import `backinstock_demo_data.zip`.
2. In **Merchant Tools > Products and Catalogs > Inventory**, set `701643037582M` to 100.
3. Run `BackInStock-ProcessWaitlist`. Check Webhook.site (or your inbox with `sfccMail`) and the `BackInStockProduct` custom object.

To try the failure handling, change the webhook URL in the service credential to `https://webhook.site/<token>/500` or `/429`. Webhook.site answers with that status code.

If a SKU is skipped, the job status message says why, for example `BELOW_THRESHOLD (ats=10, threshold=30)` or `NOT_FOUND`.
