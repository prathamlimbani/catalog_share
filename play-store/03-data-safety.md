# Play Console → Policy → App content → Data safety

Answers below are taken from the app's own privacy policy (section 3) and from
the permissions actually declared in `AndroidManifest.xml`. Filling this in
inaccurately is one of the most common causes of a Play suspension, so each row
cites where the behaviour comes from.

## Overview answers

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** — HTTPS only; the app sets `allowMixedContent: false` |
| Do you provide a way for users to request that their data be deleted? | **Yes** — https://app.catalogshare.online/legal/account-deletion.html |

## Data types to declare

For every row: **Collected = Yes**, **Shared = No** (unless noted), **Processed
ephemerally = No**, **Required or optional** as marked.

### Personal info
| Data type | Collected | Purpose | Required? |
|---|---|---|---|
| Name | Yes | App functionality, Account management | Required |
| Email address | Yes | App functionality, Account management | Required |
| Phone number | Yes | App functionality | Required |
| Address | Yes | App functionality | Optional |
| Other info (GST number, UPI ID) | Yes | App functionality | Optional |

> Source: privacy policy 3.1 — business email, password, phone, company name,
> address, GST number, UPI ID, logo.

### Financial info
| Data type | Collected | Purpose | Required? |
|---|---|---|---|
| Purchase history | Yes | App functionality | Required |

> Source: 3.4. Declare **only** purchase history. Do **not** tick "Payment
> info" — Razorpay collects the card/UPI credentials and CatalogShare never
> receives them.

### Photos and videos
| Data type | Collected | Purpose | Required? |
|---|---|---|---|
| Photos | Yes | App functionality | Optional |

> Source: 3.3 product images, plus logo and UPI QR uploads.
> Permission: `READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE` (maxSdkVersion 32).

### App activity
| Data type | Collected | Purpose | Required? |
|---|---|---|---|
| App interactions | Yes | Analytics | Required |
| Other user-generated content (customer names/phones on estimates, product data, feedback) | Yes | App functionality | Required |

> Source: 3.2 and 3.5. Note that 3.2 is data *about the merchant's own
> customers*, entered by the merchant — still declarable.

### Device or other identifiers
| Data type | Collected | Shared | Purpose | Required? |
|---|---|---|---|---|
| Device or other identifiers (Advertising ID) | Yes | **Yes — shared with Google AdMob** | Advertising or marketing | Required |

> Source: 3.6 and the `com.google.android.gms.permission.AD_ID` permission.
> This is the one row where **Shared = Yes**.

### App info and performance
| Data type | Collected | Purpose | Required? |
|---|---|---|---|
| Crash logs / diagnostics | Only if you enable Play's own reporting | Analytics | Optional |

## Things to deliberately NOT declare

| Do not tick | Why |
|---|---|
| Payment info (card, CVV, UPI PIN) | Razorpay handles it; the app never receives it |
| Precise or approximate location | No location permission is requested |
| Contacts | No contacts permission is requested |
| Messages / SMS | No SMS permission |
| Microphone / audio | Not requested |
| Health and fitness | Not applicable |
| IP address as-is | Only a **hashed** form of the visitor IP is stored (3.5) |

## Security practices section
- ✅ Data is encrypted in transit
- ✅ Users can request that data be deleted
- ✅ You follow the Play Families Policy — N/A, not targeting children
- ⬜ Independent security review — leave unticked
