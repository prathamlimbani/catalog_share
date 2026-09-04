/**
 * Phone numbers, split into a country code and a local number.
 *
 * The registration form used to be one free-text box pre-filled with "+91" and
 * validated with `phoneDigits(value).length < 10`. Every one of these got
 * through it:
 *
 *   +91 98765 4321        nine digits, and the check counted the 91
 *   919876543210          eleven digits with the code typed twice
 *   +911234567890         a number no Indian mobile can be — they start 6-9
 *   +91 0987654321        the trunk zero people add out of habit
 *
 * None of that mattered while the number was only ever turned into a wa.me
 * link. It matters now: it is the identity WhatsApp OTPs are sent to, and
 * Fast2SMS wants exactly ten digits with no country code at all, so a number
 * that is wrong in any of those ways is a code delivered to someone else or to
 * nobody.
 *
 * Splitting the field is what makes the rule enforceable. A single box cannot
 * tell "+91 9876543210" from "+919876543210" from "9876543210" without
 * guessing; two boxes never have to guess.
 */

/** A country the app will accept a number for. */
export interface Country {
  /** ISO 3166-1 alpha-2, used as the stable key. */
  code: string;
  name: string;
  /** Dial prefix, without the plus. */
  dial: string;
  /** Exact lengths the local part may be. */
  lengths: number[];
  /** Digits the local part may start with. Empty means no restriction. */
  startsWith: string[];
  flag: string;
}

/**
 * India first and default, because that is the whole customer base and because
 * it is the only one WhatsApp OTP can reach today (the Fast2SMS WABA sends to
 * Indian numbers). The rest are here so a merchant with an overseas contact
 * number is not stuck — they simply cannot be the OTP number.
 */
export const COUNTRIES: Country[] = [
  { code: "IN", name: "India", dial: "91", lengths: [10], startsWith: ["6", "7", "8", "9"], flag: "🇮🇳" },
  { code: "AE", name: "United Arab Emirates", dial: "971", lengths: [9], startsWith: ["5"], flag: "🇦🇪" },
  { code: "US", name: "United States", dial: "1", lengths: [10], startsWith: [], flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", dial: "44", lengths: [10], startsWith: ["7"], flag: "🇬🇧" },
  { code: "SG", name: "Singapore", dial: "65", lengths: [8], startsWith: ["8", "9"], flag: "🇸🇬" },
  { code: "AU", name: "Australia", dial: "61", lengths: [9], startsWith: ["4"], flag: "🇦🇺" },
  { code: "CA", name: "Canada", dial: "1", lengths: [10], startsWith: [], flag: "🇨🇦" },
  { code: "MY", name: "Malaysia", dial: "60", lengths: [9, 10], startsWith: ["1"], flag: "🇲🇾" },
  { code: "SA", name: "Saudi Arabia", dial: "966", lengths: [9], startsWith: ["5"], flag: "🇸🇦" },
  { code: "NP", name: "Nepal", dial: "977", lengths: [10], startsWith: ["9"], flag: "🇳🇵" },
  { code: "LK", name: "Sri Lanka", dial: "94", lengths: [9], startsWith: ["7"], flag: "🇱🇰" },
  { code: "BD", name: "Bangladesh", dial: "880", lengths: [10], startsWith: ["1"], flag: "🇧🇩" },
];

export const INDIA = COUNTRIES[0];

/** The only country WhatsApp OTP can currently reach. */
export const OTP_COUNTRY = INDIA;

export function findCountry(code: string | null | undefined): Country {
  return COUNTRIES.find((c) => c.code === code) ?? INDIA;
}

/** Digits only. */
export function digitsOf(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * The local part, cleaned of everything people habitually add.
 *
 * Strips the country code when it has been typed as well as selected, and the
 * trunk zero. Both are extremely common in pasted numbers and neither is part
 * of the number.
 */
export function cleanLocal(raw: unknown, country: Country = INDIA): string {
  let digits = digitsOf(raw);
  if (!digits) return "";

  const longest = Math.max(...country.lengths);

  // "919876543210" typed into a field already set to +91.
  if (digits.length > longest && digits.startsWith(country.dial)) {
    digits = digits.slice(country.dial.length);
  }
  // "09876543210".
  if (digits.length > longest && digits.startsWith("0")) {
    digits = digits.replace(/^0+/, "");
  }

  return digits.slice(0, longest);
}

/**
 * Why this number is not acceptable, or null when it is.
 *
 * Returns a sentence a merchant can act on rather than "invalid": the two
 * mistakes people actually make are the wrong length and including the country
 * code, and each deserves its own message.
 */
export function localNumberError(
  raw: unknown,
  country: Country = INDIA,
  { required = true }: { required?: boolean } = {},
): string | null {
  const digits = digitsOf(raw);

  if (!digits) return required ? "Enter a mobile number." : null;

  const expected = country.lengths;
  if (!expected.includes(digits.length)) {
    const wanted = expected.length === 1 ? `${expected[0]}` : expected.join(" or ");
    if (digits.startsWith(country.dial) && expected.includes(digits.length - country.dial.length)) {
      return `Leave out the +${country.dial} — just the ${wanted} digits.`;
    }
    return `A ${country.name} mobile number is ${wanted} digits. You have typed ${digits.length}.`;
  }

  if (country.startsWith.length > 0 && !country.startsWith.includes(digits[0])) {
    const list =
      country.startsWith.length > 1
        ? `${country.startsWith.slice(0, -1).join(", ")} or ${country.startsWith[country.startsWith.length - 1]}`
        : country.startsWith[0];
    return `A ${country.name} mobile number starts with ${list}.`;
  }

  return null;
}

/** True when the local part is a complete, valid number for the country. */
export function isValidLocalNumber(raw: unknown, country: Country = INDIA): boolean {
  return localNumberError(raw, country) === null;
}

/** "+919876543210" — the shape stored on the company row and used for wa.me. */
export function toE164(raw: unknown, country: Country = INDIA): string {
  const local = cleanLocal(raw, country);
  return local ? `+${country.dial}${local}` : "";
}

/**
 * Split a stored E.164 number back into a country and a local part, for editing.
 *
 * Longest dial code first, so +91 does not swallow a +971 number. Anything that
 * matches no known country is handed back under India with the digits intact,
 * because losing what a merchant already had is worse than mislabelling it —
 * the form still shows the number and they can correct the country.
 */
export function fromE164(stored: unknown): { country: Country; local: string } {
  const digits = digitsOf(stored);
  if (!digits) return { country: INDIA, local: "" };

  const byLongestDial = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const country of byLongestDial) {
    if (!digits.startsWith(country.dial)) continue;
    const local = digits.slice(country.dial.length);
    if (country.lengths.includes(local.length)) return { country, local };
  }

  // A bare local number with no country code — which is what the old free-text
  // field produced whenever someone deleted the "+91" prefix.
  if (INDIA.lengths.includes(digits.length)) return { country: INDIA, local: digits };

  return { country: INDIA, local: digits.slice(-Math.max(...INDIA.lengths)) };
}

/**
 * The ten digits Fast2SMS wants, or null.
 *
 * Mirrors `toIndianMobile` in server/functions/whatsapp.mjs exactly. Duplicated
 * rather than shared because the server must never trust a client-side check,
 * and the client must be able to say "that is not a valid number" without a
 * round trip. Both are tested against the same cases.
 */
export function toIndianMobile(raw: unknown): string | null {
  let digits = digitsOf(raw);
  if (!digits) return null;

  if (digits.length === 13 && digits.startsWith("091")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  if (digits.length !== 10) return null;
  if (!/^[6-9]/.test(digits)) return null;
  return digits;
}

/** Whether a WhatsApp OTP can be sent to this number at all. */
export function canReceiveOtp(raw: unknown): boolean {
  return toIndianMobile(raw) !== null;
}

/** "+91 98765 43210" — for reading back to the merchant, never for an API. */
export function formatForDisplay(raw: unknown, country: Country = INDIA): string {
  const local = cleanLocal(raw, country);
  if (!local) return "";
  if (country.code === "IN" && local.length === 10) {
    return `+${country.dial} ${local.slice(0, 5)} ${local.slice(5)}`;
  }
  return `+${country.dial} ${local}`;
}

/**
 * A number with most of it hidden — "+91 ••••• 43210".
 *
 * Shown on the OTP screen so the merchant can confirm the code went to the
 * right phone without the screen itself becoming a way to read a number off
 * somebody's shoulder.
 */
export function maskForDisplay(raw: unknown): string {
  const digits = digitsOf(raw);
  if (digits.length < 4) return "your number";
  return `•••••• ${digits.slice(-4)}`;
}
