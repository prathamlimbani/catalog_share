# Play Console → Policy → App content

Every item below is mandatory. Play blocks the release until all are green.

## Privacy policy
```
https://app.catalogshare.online/legal/privacy.html
```
Must be reachable without logging in. ✅ Verified live and returning 200.

## Ads
**Does your app contain ads? → YES**

The AdMob SDK ships in the bundle and free-tier users are shown banner and
interstitial ads. Declare yes even while test ad units are in place — the
declaration is about the app's behaviour, not your revenue.

## App access
**All functionality is available without special access? → NO**

Play reviewers need a working login to see past the sign-in screen. Provide:

| Field | Value |
|---|---|
| Instructions name | Merchant demo account |
| Username | *create a throwaway account and put its email here* |
| Password | *that account's password* |
| Any other instructions | "Sign in with the credentials above to reach the dashboard. The public storefront at https://app.catalogshare.online/store/<any-slug> needs no login." |

⚠️ Create a **dedicated demo account** with sample products. Do not give reviewers a real merchant's login.

## Content rating
Fill in the questionnaire. For this app the honest answers are:

| Question | Answer |
|---|---|
| Category | Utility, Productivity, Communication, or Other |
| Violence | No |
| Sexual content | No |
| Profanity | No |
| Controlled substances | No |
| User-generated content shared with others | **Yes** — merchants publish product catalogs and buyers submit feedback |
| Users can interact / share location | No |
| Digital purchases | **Yes** |

Expected outcome: **Rated for 3+ / Everyone**, but see Target audience below.

## Target audience and content
**Target age group → 18 and over only.**

This matters: the app requires a business account, takes payments, and serves
AdMob ads. Selecting any under-18 bracket pulls you into Families policy and
forces ad-content restrictions the app does not implement.

**Are children a target audience? → No**

## Data safety
See `03-data-safety.md` — it is long enough to need its own file.

## Government apps
**Is this a government app? → No**

## Financial features
**Does your app provide financial features? → No**

The app takes subscription payments for its own service. It is not a lending,
investment, insurance or money-transfer product, so none of the financial
feature declarations apply.

## Health apps
**Not a health app → No declaration needed**

## News apps
**Is this a news app? → No**

## Data deletion
Play requires a way to request account deletion from outside the app:
```
https://app.catalogshare.online/legal/account-deletion.html
```
✅ Verified live. It documents in-app deletion and the email route.
