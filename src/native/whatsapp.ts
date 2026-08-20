/**
 * Sending an estimate to one specific customer on WhatsApp.
 *
 * The share sheet can attach a PDF but not choose a recipient, so it dropped the
 * merchant into a contact picker and ignored the number they had just typed.
 * This routes through the small native plugin in
 * android/app/src/main/java/in/catalogshare/app/WhatsAppPlugin.java, which opens
 * the named chat with the file already attached.
 */

import { registerPlugin } from "@capacitor/core";
import { isNative } from "./platform";

export type WhatsAppSendMode =
  /** The named chat opened with the PDF attached — what we want. */
  | "chat_with_file"
  /** The named chat opened, but text only. */
  | "chat_without_file"
  /** The named chat opened; there was no file to send anyway. */
  | "chat"
  /** The PDF was handed to WhatsApp but it asked who to send it to. */
  | "picker_with_file";

interface WhatsAppSharePlugin {
  isAvailable(): Promise<{ available: boolean; packageName: string }>;
  sendToNumber(options: { phone: string; text: string; fileUri?: string }): Promise<{
    sent: boolean;
    mode: WhatsAppSendMode;
    packageName: string;
  }>;
}

const WhatsAppShare = registerPlugin<WhatsAppSharePlugin>("WhatsAppShare");

/**
 * Normalise an Indian mobile number to the digits WhatsApp expects.
 *
 * Handles the shapes merchants actually type: "98765 43210", "+91 98765-43210",
 * "0919876543210", "919876543210". Returns "" when it cannot be made sense of,
 * so the caller can refuse rather than open an empty chat.
 */
export function toWhatsAppNumber(raw: string, defaultCountryCode = "91"): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";

  // Strip the international access prefix people paste from contact apps.
  digits = digits.replace(/^00/, "");
  // A single leading 0 is the domestic trunk prefix, never part of the number.
  digits = digits.replace(/^0+/, "");

  // Already carries a country code.
  if (digits.length > 10) return digits;
  if (digits.length === 10) return defaultCountryCode + digits;

  // Too short to be a real mobile number.
  return "";
}

export async function isWhatsAppInstalled(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const { available } = await WhatsAppShare.isAvailable();
    return available;
  } catch {
    return false;
  }
}

export interface SendResult {
  ok: boolean;
  mode?: WhatsAppSendMode;
  error?: string;
}

/**
 * Open the given customer's WhatsApp chat, with the PDF attached when possible.
 *
 * Resolves rather than throws; the caller decides what to tell the user based on
 * which fallback rung was reached.
 */
export async function sendEstimateToNumber(options: {
  phone: string;
  text: string;
  fileUri?: string;
}): Promise<SendResult> {
  if (!isNative) return { ok: false, error: "Only available in the app" };

  const phone = toWhatsAppNumber(options.phone);
  if (!phone) return { ok: false, error: "Enter a valid mobile number with country code" };

  try {
    const result = await WhatsAppShare.sendToNumber({ ...options, phone });
    return { ok: !!result?.sent, mode: result?.mode };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
