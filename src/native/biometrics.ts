/**
 * Biometric app lock.
 *
 * This app holds a merchant's customer list, their prices and their revenue, so
 * on a shared or a misplaced phone the fingerprint/face check is the only thing
 * between that data and whoever picked the phone up.
 *
 * Two rules shape everything below:
 *  - Nothing here throws. A lock that can crash is worse than no lock.
 *  - Nothing here traps the user. Every path that could leave someone unable to
 *    get in (no enrolment, no screen lock, a sensor that stopped working) either
 *    fails open or leaves an escape — a merchant locked out of their own
 *    estimates would uninstall, and Play treats a dead end as a policy issue.
 */

import {
  NativeBiometric,
  BiometryType,
  type AvailableResult,
  type BiometricOptions,
} from "@capgo/capacitor-native-biometric";

import { isNative } from "./platform";
import { PREF_KEYS, prefGet, prefRemove, prefSet } from "./prefs";

export interface BiometricStatus {
  /** Something on this device can verify the user — a biometric or the PIN. */
  available: boolean;
  /** Human label for the settings hint: "Fingerprint", "Face unlock", "Screen lock". */
  type: string;
  /** A PIN/pattern/password is set. Without one there is nothing to verify against. */
  deviceSecure: boolean;
}

const UNAVAILABLE: BiometricStatus = {
  available: false,
  type: "Not available",
  deviceSecure: false,
};

/**
 * How long the app may sit in the background before it re-locks.
 *
 * Sending an estimate over WhatsApp is the single most common thing anyone does
 * in this app, and it backgrounds us every single time. Prompting on the way
 * back would make the lock unusable, so a short trip out is treated as never
 * having left.
 */
export const LOCK_GRACE_MS = 60_000;

/**
 * Rejection codes meaning "the prompt could not even be shown for want of an
 * enrolled biometric", as opposed to the user failing or cancelling it.
 * (BiometricAuthError.BIOMETRICS_UNAVAILABLE / BIOMETRICS_NOT_ENROLLED — the
 * native bridge hands these back as strings.)
 */
const NO_ENROLMENT_CODES = new Set(["1", "3"]);

function labelFor(type: BiometryType, deviceSecure: boolean): string {
  switch (type) {
    case BiometryType.TOUCH_ID:
    case BiometryType.FINGERPRINT:
      return "Fingerprint";
    case BiometryType.FACE_ID:
    case BiometryType.FACE_AUTHENTICATION:
      return "Face unlock";
    case BiometryType.IRIS_AUTHENTICATION:
      return "Iris scan";
    case BiometryType.MULTIPLE:
      return "Fingerprint or face";
    case BiometryType.DEVICE_CREDENTIAL:
      return "Screen lock";
    default:
      // NONE — but a PIN still counts, and it is what the user will be asked for.
      return deviceSecure ? "Screen lock" : "Not available";
  }
}

async function rawStatus(): Promise<AvailableResult | null> {
  // The plugin's web implementation answers `isAvailable: true` and resolves
  // verifyIdentity() unconditionally, so on web it would advertise a lock that
  // verifies nobody. The browser build never gets past this line.
  if (!isNative) return null;
  try {
    // useFallback makes a device that has a PIN but no enrolled fingerprint
    // count as available — without it the lock could not be turned on at all on
    // such a device, which is a lot of cheap Android hardware.
    return await NativeBiometric.isAvailable({ useFallback: true });
  } catch (err) {
    console.warn("[biometrics] availability check failed:", err);
    return null;
  }
}

/** What this device can do, phrased for the settings screen. Never throws. */
export async function isBiometricAvailable(): Promise<BiometricStatus> {
  const status = await rawStatus();
  if (!status) return UNAVAILABLE;
  return {
    available: status.isAvailable,
    type: labelFor(status.biometryType, status.deviceIsSecure),
    deviceSecure: status.deviceIsSecure,
  };
}

interface VerifyOutcome {
  ok: boolean;
  /** Native rejection code, when the bridge supplied one. */
  code?: string;
}

async function verify(reason: string, credentialOnly: boolean): Promise<VerifyOutcome> {
  const options: BiometricOptions = {
    reason,
    title: "CatalogShare",
    subtitle: credentialOnly ? "Enter your screen lock" : "Verify it's you",
    description: reason,
    negativeButtonText: "Cancel",
    // iOS only: offers the passcode after Face/Touch ID fails. Android ignores
    // it — BiometricPrompt cannot show a negative button and the device
    // credential at the same time — which is what credentialOnly is for.
    useFallback: true,
    maxAttempts: 3,
  };

  if (credentialOnly) {
    // Naming DEVICE_CREDENTIAL is the only way to reach the PIN sheet on
    // Android. It also drops the Cancel button, which is why it is not the
    // default: the system back gesture still dismisses it.
    options.allowedBiometryTypes = [BiometryType.DEVICE_CREDENTIAL];
  }

  try {
    await NativeBiometric.verifyIdentity(options);
    return { ok: true };
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code)
        : undefined;
    console.warn("[biometrics] verifyIdentity rejected:", code, err);
    return { ok: false, code };
  }
}

/**
 * Ask the user to prove who they are. Resolves false on failure, cancel or any
 * native error, so callers can treat it as a plain boolean.
 */
export async function authenticate(reason: string): Promise<boolean> {
  const status = await rawStatus();
  if (!status || !status.isAvailable) return false;

  // No enrolled biometric means the prompt has nothing to show, so go straight
  // to the PIN instead of spending a guaranteed failure on the user.
  const credentialOnly =
    status.biometryType === BiometryType.NONE ||
    status.biometryType === BiometryType.DEVICE_CREDENTIAL;

  const first = await verify(reason, credentialOnly);
  if (first.ok) return true;

  // Fall back to the PIN only when the sensor turned out to have no enrolment
  // after all — an OEM can advertise a face sensor nobody ever set up. A cancel
  // or a wrong finger must NOT raise a second prompt: that reads as the app
  // refusing to take no for an answer.
  if (
    !credentialOnly &&
    status.deviceIsSecure &&
    first.code !== undefined &&
    NO_ENROLMENT_CODES.has(first.code)
  ) {
    return (await verify(reason, true)).ok;
  }

  return false;
}

// ------------------------------------------------------------------ setting

export async function isLockEnabled(): Promise<boolean> {
  return (await prefGet(PREF_KEYS.appLock)) === "1";
}

/**
 * Turn the lock on or off. Returns whether the change was actually made.
 *
 * Both directions require a successful check. Turning it ON without one lets a
 * user arm a lock they cannot pass; turning it OFF without one lets anyone
 * holding the unlocked phone disable it in two taps, which defeats the feature.
 */
export async function setLockEnabled(on: boolean): Promise<boolean> {
  const passed = await authenticate(
    on ? "Confirm it's you to turn on the app lock" : "Confirm it's you to turn off the app lock",
  );
  if (!passed) return false;

  await prefSet(PREF_KEYS.appLock, on ? "1" : "0");
  return true;
}

/**
 * Drop the lock without asking for anything.
 *
 * Reserved for the two cases where a prompt is impossible or pointless: the
 * user signing out from the lock screen (the session takes the local data with
 * it, so there is nothing left to guard and the next sign-in must not meet a
 * lock nobody can pass), and a device that has lost its screen lock entirely.
 */
export async function disableLockLocally(): Promise<void> {
  await prefRemove(PREF_KEYS.appLock);
}

/**
 * Whether a resume should re-prompt.
 *
 * `null` means no pause was recorded for this session — a cold start, or a
 * resume we cannot pair with a pause. Both lock, which is the safe direction.
 */
export function shouldLockNow(lastBackgroundedAt: number | null): boolean {
  if (lastBackgroundedAt === null) return true;
  const elapsed = Date.now() - lastBackgroundedAt;
  // A negative elapsed time means the clock moved backwards while we were away;
  // trusting it would hand out an unbounded grace period.
  return elapsed < 0 || elapsed > LOCK_GRACE_MS;
}
