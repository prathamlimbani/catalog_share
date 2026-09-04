/**
 * Phone normalisation.
 *
 * Pinned hard because this is the one place a mistake sends somebody else a
 * code for this account. `toIndianMobile` in particular is duplicated in
 * server/functions/whatsapp.mjs — the server must never trust a client-side
 * check, and the client must be able to reject a bad number without a round
 * trip — so the cases here are the contract between the two copies.
 */

import { describe, it, expect } from "vitest";

import {
  COUNTRIES,
  INDIA,
  canReceiveOtp,
  cleanLocal,
  findCountry,
  formatForDisplay,
  fromE164,
  isValidLocalNumber,
  localNumberError,
  maskForDisplay,
  toE164,
  toIndianMobile,
} from "@/lib/phone";

describe("toIndianMobile", () => {
  it.each([
    ["9663559022", "9663559022"],
    ["+919663559022", "9663559022"],
    ["919663559022", "9663559022"],
    ["09663559022", "9663559022"],
    ["0919663559022", "9663559022"],
    ["+91 96635 59022", "9663559022"],
    ["+91-96635-59022", "9663559022"],
  ])("accepts %s", (input, expected) => {
    expect(toIndianMobile(input)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["98765 4321", "nine digits"],
    ["98765432101", "eleven digits"],
    ["1234567890", "starts with 1 — no Indian mobile does"],
    ["5555555555", "starts with 5"],
    ["0000000000", "the classic required-field filler"],
    ["+14155552671", "a US number"],
  ])("rejects %s (%s)", (input) => {
    expect(toIndianMobile(input)).toBeNull();
  });

  it("does not confuse a country code with the number", () => {
    // The exact bug the old single free-text field had: `phoneDigits(value)
    // .length < 10` counted the "91" and let a nine-digit number through.
    expect(toIndianMobile("+91987654321")).toBeNull();
  });

  it("agrees with canReceiveOtp", () => {
    expect(canReceiveOtp("+919663559022")).toBe(true);
    expect(canReceiveOtp("+14155552671")).toBe(false);
  });
});

describe("cleanLocal", () => {
  it("strips a country code typed on top of the selected one", () => {
    expect(cleanLocal("919663559022", INDIA)).toBe("9663559022");
  });

  it("strips the trunk zero people add out of habit", () => {
    expect(cleanLocal("09663559022", INDIA)).toBe("9663559022");
  });

  it("keeps a plain local number untouched", () => {
    expect(cleanLocal("9663559022", INDIA)).toBe("9663559022");
  });

  it("drops everything that is not a digit", () => {
    expect(cleanLocal("(966) 355-9022", INDIA)).toBe("9663559022");
  });

  it("never returns more digits than the country allows", () => {
    // What stops an eleventh digit being typed into the field at all.
    expect(cleanLocal("96635590221234", INDIA)).toHaveLength(10);
  });
});

describe("localNumberError", () => {
  it("passes a good Indian number", () => {
    expect(localNumberError("9663559022", INDIA)).toBeNull();
    expect(isValidLocalNumber("9663559022", INDIA)).toBe(true);
  });

  it("names the actual problem rather than saying invalid", () => {
    expect(localNumberError("96635", INDIA)).toMatch(/10 digits/);
    expect(localNumberError("96635", INDIA)).toMatch(/typed 5/);
  });

  it("recognises the country code being included and says so", () => {
    // The single most common mistake, and "12 digits" would not help anyone.
    expect(localNumberError("919663559022", INDIA)).toMatch(/Leave out the \+91/);
  });

  it("rejects a first digit no Indian mobile uses", () => {
    expect(localNumberError("1234567890", INDIA)).toMatch(/starts with 6, 7, 8 or 9/);
  });

  it("requires a number only when asked to", () => {
    expect(localNumberError("", INDIA)).toMatch(/Enter a mobile number/);
    expect(localNumberError("", INDIA, { required: false })).toBeNull();
  });

  it("applies each country's own rule", () => {
    const uae = findCountry("AE");
    expect(localNumberError("501234567", uae)).toBeNull();
    expect(localNumberError("601234567", uae)).toMatch(/starts with 5/);
  });
});

describe("toE164 and fromE164", () => {
  it("round-trips an Indian number", () => {
    const stored = toE164("9663559022", INDIA);
    expect(stored).toBe("+919663559022");
    const back = fromE164(stored);
    expect(back.country.code).toBe("IN");
    expect(back.local).toBe("9663559022");
  });

  it("does not let +91 swallow a +971 number", () => {
    // Longest dial code first. Matching "91" against "971..." would relabel
    // every UAE number as Indian and then fail its length check.
    const back = fromE164("+971501234567");
    expect(back.country.code).toBe("AE");
    expect(back.local).toBe("501234567");
  });

  it("recovers a bare number the old free-text field left behind", () => {
    const back = fromE164("9663559022");
    expect(back.country.code).toBe("IN");
    expect(back.local).toBe("9663559022");
  });

  it("hands back the digits rather than losing them when nothing matches", () => {
    // Mislabelling is recoverable — the merchant can change the country. Losing
    // what they already had is not.
    expect(fromE164("+99912345").local).not.toBe("");
  });

  it("returns an empty string for nothing, so a blank field stays blank", () => {
    expect(toE164("", INDIA)).toBe("");
    expect(fromE164(null).local).toBe("");
  });
});

describe("display helpers", () => {
  it("groups an Indian number the way people read it", () => {
    expect(formatForDisplay("9663559022", INDIA)).toBe("+91 96635 59022");
  });

  it("shows only the last four digits when masking", () => {
    const masked = maskForDisplay("+919663559022");
    expect(masked).toContain("9022");
    expect(masked).not.toContain("96635");
  });

  it("does not pretend to mask something too short to mask", () => {
    expect(maskForDisplay("12")).toBe("your number");
  });
});

describe("the country list", () => {
  it("has India first, because that is the default and the only OTP country", () => {
    expect(COUNTRIES[0].code).toBe("IN");
    expect(INDIA.lengths).toEqual([10]);
  });

  it("falls back to India for an unknown code rather than crashing", () => {
    expect(findCountry("ZZ").code).toBe("IN");
    expect(findCountry(null).code).toBe("IN");
  });

  it("gives every country at least one length", () => {
    for (const c of COUNTRIES) {
      expect(c.lengths.length).toBeGreaterThan(0);
      expect(c.dial).toMatch(/^\d+$/);
    }
  });
});
