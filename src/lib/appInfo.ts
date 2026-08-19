/**
 * App-wide constants.
 *
 * Contact details live here rather than being retyped in each component — they
 * were previously hardcoded in four different files, which is how the support
 * number ended up unreachable from half the app.
 */

export const APP_NAME = "CatalogShare";

/** Keep in step with android/app/build.gradle versionName. */
export const APP_VERSION = "1.0.2";

/** Permanent Play Store identity. Never change this. */
export const ANDROID_PACKAGE = "in.catalogshare.app";

export const WEBSITE_URL = "https://catalogshare.online";

export const SUPPORT_EMAIL = "catalogshare123@gmail.com";
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
