/**
 * Saving and sharing generated documents (estimates, invoices, receipts).
 *
 * Why this exists: inside an Android WebView a `blob:` URL, an `<a download>`
 * and `window.open()` are all inert — the file is generated and then silently
 * discarded. Every download path in the app therefore goes:
 *
 *     Blob → base64 → Filesystem.writeFile → Share.share({ files })
 *
 * which works with no network, attaches the real PDF to WhatsApp/Gmail, and
 * removes the old flow's need to upload customer PII to a public bucket just to
 * produce a shareable link.
 */

import { Filesystem, Directory, type WriteFileResult } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Toast } from "@capacitor/toast";
import { isNative } from "./platform";

/** Strip the `data:...;base64,` prefix the FileReader gives us. */
function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.onload = () => resolve(stripDataUrlPrefix(String(reader.result)));
    reader.readAsDataURL(blob);
  });
}

/** Fetch a remote asset and inline it as a data URI (used for the company logo). */
export async function urlToDataUri(url: string, timeoutMs = 15000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    // Keep the mirror small — a multi-MB logo makes every PDF render crawl.
    if (blob.size > 2_000_000) return null;
    const b64 = await blobToBase64(blob);
    return `data:${blob.type || "image/png"};base64,${b64}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Filesystem-safe file name. */
export function safeFileName(name: string, ext = "pdf"): string {
  const cleaned = (name || "document")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${cleaned || "document"}.${ext}`;
}

export interface SaveResult {
  ok: boolean;
  /** Native file URI, present only on device. */
  uri?: string;
  fileName: string;
  /** Human-readable place the file ended up, for the confirmation toast. */
  location?: string;
  error?: string;
}

/**
 * Persist a blob to the device.
 *
 * On native this walks a fallback chain of save locations (see below); on web it
 * is an ordinary browser download.
 */
export async function saveBlob(blob: Blob, fileName: string): Promise<SaveResult> {
  if (!isNative) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return { ok: true, fileName };
    } catch (err) {
      return { ok: false, fileName, error: String(err) };
    }
  }

  const data = await blobToBase64(blob);
  const path = `CatalogShare/${fileName}`;

  // Directory.Documents maps to Environment.getExternalStoragePublicDirectory(),
  // which scoped storage blocks outright from targetSdk 29 upwards — so on any
  // current device this write throws. It is still attempted first because on the
  // devices where it DOES work the file lands somewhere the user can actually
  // find it, and Directory.External (app-specific external storage, no permission
  // required at any API level) is the fallback that always succeeds.
  const targets: Array<{ directory: Directory; label: string }> = [
    { directory: Directory.Documents, label: "Documents/CatalogShare" },
    { directory: Directory.External, label: "app storage" },
    { directory: Directory.Cache, label: "temporary storage" },
  ];

  let lastError = "";
  for (const target of targets) {
    try {
      const result: WriteFileResult = await Filesystem.writeFile({
        path,
        data,
        directory: target.directory,
        recursive: true,
      });
      return { ok: true, uri: result.uri, fileName, location: target.label };
    } catch (err) {
      lastError = String(err);
    }
  }

  console.warn("[files] every save location failed:", lastError);
  return { ok: false, fileName, error: lastError };
}

/**
 * Write to the cache directory — for files that only exist to be handed to the
 * share sheet and should not clutter the user's Documents folder.
 */
async function writeToCache(blob: Blob, fileName: string): Promise<string | null> {
  try {
    const data = await blobToBase64(blob);
    const result = await Filesystem.writeFile({
      path: `shared/${fileName}`,
      data,
      directory: Directory.Cache,
      recursive: true,
    });
    return result.uri;
  } catch (err) {
    console.warn("[files] cache write failed:", err);
    return null;
  }
}

export interface ShareOptions {
  title?: string;
  text?: string;
  /** Shown as the share-sheet title on Android. */
  dialogTitle?: string;
}

/**
 * Share a generated document through the native share sheet (WhatsApp, Gmail,
 * Drive, Bluetooth…). Falls back to the Web Share API, then to a download.
 */
export async function shareBlob(
  blob: Blob,
  fileName: string,
  options: ShareOptions = {},
): Promise<SaveResult> {
  const { title, text, dialogTitle } = options;

  if (isNative) {
    const uri = await writeToCache(blob, fileName);
    if (uri) {
      try {
        await Share.share({
          title,
          text,
          files: [uri],
          dialogTitle: dialogTitle ?? "Share",
        });
        return { ok: true, uri, fileName };
      } catch (err) {
        // The user dismissing the share sheet lands here too — not an error.
        const msg = String(err);
        if (/cancel/i.test(msg)) return { ok: false, fileName, error: "cancelled" };
        console.warn("[files] share failed, falling back to save:", err);
      }
    }
    return saveBlob(blob, fileName);
  }

  // Web: try the Web Share API with a real file attachment.
  try {
    const file = new File([blob], fileName, { type: blob.type || "application/pdf" });
    const nav = navigator as Navigator & {
      canShare?: (d: ShareData & { files?: File[] }) => boolean;
      share?: (d: ShareData & { files?: File[] }) => Promise<void>;
    };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ title, text, files: [file] });
      return { ok: true, fileName };
    }
  } catch {
    /* fall through to download */
  }

  return saveBlob(blob, fileName);
}

/** Share plain text (used by the "share store link" action). */
export async function shareText(text: string, title?: string, url?: string): Promise<boolean> {
  try {
    await Share.share({ title, text, url, dialogTitle: title ?? "Share" });
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(url ? `${text} ${url}` : text);
      await notify("Copied to clipboard");
      return true;
    } catch {
      return false;
    }
  }
}

/** Short confirmation message — a native toast on device, console on web. */
export async function notify(message: string): Promise<void> {
  if (!isNative) return;
  try {
    await Toast.show({ text: message, duration: "short", position: "bottom" });
  } catch {
    /* toast is cosmetic */
  }
}

/**
 * Open a WhatsApp chat with a prefilled message.
 *
 * Capacitor's BridgeWebViewClient hands non-http schemes to an Android Intent,
 * so `whatsapp://` opens the app directly and avoids the wa.me web redirect
 * that mobile browsers were blocking (the bug fixed in commit c250dc1).
 */
export async function openWhatsApp(phoneDigits: string, message: string): Promise<void> {
  const clean = (phoneDigits || "").replace(/\D/g, "");
  const encoded = encodeURIComponent(message);

  if (isNative && clean) {
    window.location.href = `whatsapp://send?phone=${clean}&text=${encoded}`;
    return;
  }

  const url = clean
    ? `https://wa.me/${clean}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;

  if (isNative) {
    window.location.href = url;
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
