/**
 * App-wide constants.
 *
 * Contact details live here rather than being retyped in each component — they
 * were previously hardcoded in four different files, which is how the support
 * number ended up unreachable from half the app.
 */

export const APP_NAME = "CatalogShare";

/** Keep in step with android/app/build.gradle versionName. */
export const APP_VERSION = "1.0.11";

/** Permanent Play Store identity. Never change this. */
export const ANDROID_PACKAGE = "in.catalogshare.app";

export const WEBSITE_URL = "https://app.catalogshare.online";

export const SUPPORT_EMAIL = "catalogshare123@gmail.com";

/**
 * Phone support.
 *
 * This is a personal number, so it is defined ONCE and gated behind a single
 * switch. Set SUPPORT_PHONE_ENABLED to false and every phone affordance in the
 * app disappears — the Call support row, the support dialog, the Billing
 * contact card and the line printed on every payment receipt — leaving email as
 * the only support channel.
 *
 * Note before flipping it: the Pro (₹349) and Support (₹499) plans advertise
 * "Priority & Call Support", so removing the phone changes what those plans
 * deliver. Update the plan copy in src/lib/plans.ts at the same time.
 *
 * WhatsApp support was removed outright — a wa.me link exposes the number to
 * the user's own chat list, which is a wider leak than a tel: link.
 */
export const SUPPORT_PHONE_ENABLED = true;
export const SUPPORT_PHONE = "+91 76250 25686";
export const SUPPORT_PHONE_DIGITS = "917625025686";

export const LEGAL_URLS = {
  terms: `${WEBSITE_URL}/legal/terms.html`,
  privacy: `${WEBSITE_URL}/legal/privacy.html`,
  refund: `${WEBSITE_URL}/legal/refund.html`,
  accountDeletion: `${WEBSITE_URL}/legal/account-deletion.html`,
} as const;

/** Public URL of a merchant's storefront. */
export function storeUrl(slug: string): string {
  return `${WEBSITE_URL}/store/${slug}`;
}
