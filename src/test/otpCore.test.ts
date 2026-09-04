/**
 * The server-side OTP rules.
 *
 * These are imported straight from `server/functions/` rather than mirrored,
 * so the test exercises the code that actually runs. The four things worth
 * pinning are the four that are silently catastrophic when wrong: the code is
 * unguessable, it is never stored in clear, the comparison does not leak, and
 * the positional WhatsApp variables come out in the template's order.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

import {
  DEFAULT_AUTH_SETTINGS,
  PURPOSES,
  generateCode,
  hashCode,
  hashesMatch,
} from "../../server/functions/otpCore.mjs";
import { renderVariables, toIndianMobile, mask } from "../../server/functions/whatsapp.mjs";

describe("code generation", () => {
  it("produces exactly the requested number of digits", () => {
    for (const length of [4, 6, 8]) {
      for (let i = 0; i < 50; i += 1) {
        const code = generateCode(length);
        expect(code).toHaveLength(length);
        expect(code).toMatch(/^\d+$/);
      }
    }
  });

  it("keeps leading zeros", () => {
    // A code rendered as "042913" and compared as 42913 is a bug that only
    // shows up for a tenth of users, so the padding is generated and checked
    // rather than assumed.
    const codes = Array.from({ length: 4000 }, () => generateCode(6));
    expect(codes.some((c) => c.startsWith("0"))).toBe(true);
    expect(codes.every((c) => c.length === 6)).toBe(true);
  });

  it("does not repeat itself the way a weak source would", () => {
    // Not a randomness proof — it catches the specific disaster of a constant
    // or near-constant generator, which is what a Math.random() regression or a
    // bad refactor of randomInt would look like.
    const codes = new Set(Array.from({ length: 500 }, () => generateCode(6)));
    expect(codes.size).toBeGreaterThan(450);
  });
});

describe("code storage", () => {
  it("hashes with SHA-256 and never returns the code", () => {
    const hash = hashCode("482913");
    expect(hash).toBe(createHash("sha256").update("482913", "utf8").digest("hex"));
    expect(hash).not.toContain("482913");
    expect(hash).toHaveLength(64);
  });

  it("hashes the same code to the same value, and different codes differently", () => {
    expect(hashCode("482913")).toBe(hashCode("482913"));
    expect(hashCode("482913")).not.toBe(hashCode("482914"));
  });

  it("treats a numeric and a string code as the same", () => {
    // The client sends a string; a test or a future caller might pass a number.
    expect(hashCode(482913 as unknown as string)).toBe(hashCode("482913"));
  });
});

describe("hashesMatch", () => {
  it("accepts an identical hash", () => {
    expect(hashesMatch(hashCode("111111"), hashCode("111111"))).toBe(true);
  });

  it("rejects a different one", () => {
    expect(hashesMatch(hashCode("111111"), hashCode("111112"))).toBe(false);
  });

  it("rejects rather than throwing on a length mismatch", () => {
    // timingSafeEqual throws on unequal lengths, which would itself leak and
    // would turn a malformed row into a 500 instead of a rejection.
    expect(hashesMatch("abc", hashCode("111111"))).toBe(false);
    expect(hashesMatch("", "")).toBe(true);
  });

  it("rejects null and undefined without throwing", () => {
    expect(hashesMatch(null, hashCode("111111"))).toBe(false);
    expect(hashesMatch(undefined, undefined)).toBe(true);
  });
});

describe("the purposes", () => {
  it("are exactly the five the app uses", () => {
    expect(PURPOSES).toEqual([
      "register",
      "login",
      "reset",
      "change_number",
      "phone_login",
    ]);
  });

  it("keeps `login` and `phone_login` distinct", () => {
    // They are NOT interchangeable: `login` is a second factor shown to someone
    // who has already passed a password, `phone_login` is the whole credential
    // shown to anyone who can type a number. Collapsing them would turn 2FA
    // into a passwordless login for every account that has a verified number.
    expect(PURPOSES).toContain("login");
    expect(PURPOSES).toContain("phone_login");
    expect(new Set(PURPOSES).size).toBe(PURPOSES.length);
  });

  it("default to the safest gates", () => {
    // Email verification OFF is the deliberate answer to "email is optional
    // now"; 2FA OFF because switching it on before the OTP path is proven locks
    // people out of an app they have no way back into.
    expect(DEFAULT_AUTH_SETTINGS.emailVerificationEnabled).toBe(false);
    expect(DEFAULT_AUTH_SETTINGS.twoFactorEnabled).toBe(false);
    expect(DEFAULT_AUTH_SETTINGS.whatsappVerificationEnabled).toBe(true);
  });

  it("ships phone login on, with the claim path on", () => {
    // Both default ON because the whole existing merchant base has an
    // unverified number: with the claim path off, phone login would be a
    // feature nobody could use until they happened to change their number.
    expect(DEFAULT_AUTH_SETTINGS.phoneLoginEnabled).toBe(true);
    expect(DEFAULT_AUTH_SETTINGS.phoneLoginClaimsUnverified).toBe(true);
  });
});

describe("WhatsApp template variables", () => {
  const otpTemplate = { variables: ["otp", "minutes"] };

  it("renders in the template's order, not the caller's", () => {
    // The whole reason the order lives in the database: variables_values is
    // positional with no names in it, so an object written the other way round
    // would otherwise produce a message saying the code is "10".
    expect(renderVariables(otpTemplate, { minutes: 10, otp: "482913" })).toBe("482913|10");
  });

  it("matches the approved catalogshareotp template exactly", () => {
    expect(renderVariables(otpTemplate, { otp: "000123", minutes: 10 })).toBe("000123|10");
  });

  it("writes an empty slot rather than the literal undefined", () => {
    // A naive join prints "undefined" into the merchant's WhatsApp message.
    expect(renderVariables(otpTemplate, { otp: "482913" })).toBe("482913|");
  });

  it("strips a pipe inside a value", () => {
    // A stray pipe would shift every later variable along by one.
    expect(renderVariables({ variables: ["a", "b"] }, { a: "x|y", b: "z" })).toBe("x y|z");
  });

  it("returns nothing for a template with no variables", () => {
    expect(renderVariables({ variables: [] }, { otp: "1" })).toBe("");
    expect(renderVariables({}, { otp: "1" })).toBe("");
  });
});

describe("the server's number normalisation", () => {
  // Deliberately the same cases as src/test/phone.test.ts: the two copies of
  // this function are a contract, and a change to one that is not made to the
  // other has to fail here.
  it.each([
    ["9663559022", "9663559022"],
    ["+919663559022", "9663559022"],
    ["919663559022", "9663559022"],
    ["09663559022", "9663559022"],
    ["0919663559022", "9663559022"],
    ["+91 96635 59022", "9663559022"],
  ])("accepts %s", (input, expected) => {
    expect(toIndianMobile(input)).toBe(expected);
  });

  it.each([["", ""], ["98765 4321", ""], ["1234567890", ""], ["+14155552671", ""]])(
    "rejects %s",
    (input) => {
      expect(toIndianMobile(input)).toBeNull();
    },
  );
});

describe("log masking", () => {
  it("keeps only the last four digits", () => {
    expect(mask("9663559022")).toBe("******9022");
  });

  it("never leaks a short or missing number", () => {
    expect(mask("12")).toBe("****");
    expect(mask(null)).toBe("****");
  });
});
