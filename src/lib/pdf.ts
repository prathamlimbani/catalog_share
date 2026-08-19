/**
 * PDF generation and delivery.
 *
 * html2pdf.js is a bundled dependency, so rasterising happens entirely on the
 * device and works with no network. What did NOT work on Android was the
 * delivery step: `.save()` triggers a `blob:` download, and a WebView with no
 * DownloadListener discards it silently — the user tapped "Download PDF" and
 * nothing whatsoever happened. Everything now routes through
 * src/native/files.ts, which writes a real file and opens the share sheet.
 */

import { saveBlob, shareBlob, notify, safeFileName, type SaveResult } from "@/native/files";
import { isNative } from "@/native/platform";

export interface PdfOptions {
  /** File name without extension. */
  name: string;
  /** Share sheet title / message. */
  title?: string;
  text?: string;
  /**
   * Rasterisation scale. 1.5 is a deliberate step down from 2: html2canvas at
   * scale 2 on a full-page A4 capture routinely OOMs the renderer process on
   * mid-range Android devices.
   */
  scale?: number;
}

/**
 * Turn whatever the PDF stack threw into a sentence a merchant can act on.
 *
 * html2canvas rejects with bare strings and DOM exceptions at least as often as
 * with `Error`s, and because html2pdf is loaded on demand a first export with
 * no cached chunk fails with a module-resolution TypeError. None of those read
 * as an explanation, so the cases we can recognise get named.
 */
export function pdfErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err ?? "");

  if (/dynamically imported module|Importing a module script failed|Loading chunk/i.test(raw)) {
    return "The PDF engine could not load. Reconnect once so the app can finish downloading it.";
  }
  if (/tainted|SecurityError|cross-origin/i.test(raw)) {
    return "An image on the document could not be rendered. Try again without the logo.";
  }
  if (/out of memory|Maximum call stack|Array buffer allocation/i.test(raw)) {
    return "This document was too large to render on this device. Try splitting it into fewer items.";
  }
  return raw.trim() || "The PDF could not be generated.";
}

/** Render a live DOM element to a PDF Blob. Throws a readable Error on failure. */
export async function elementToPdfBlob(
  element: HTMLElement | null,
  options: PdfOptions,
): Promise<Blob> {
  if (!element) throw new Error("Nothing to export");

  // `pagebreak` is a documented html2pdf option that keeps table rows from
  // being sliced across pages, but the library declares its options interface
  // privately inside its own module block, so it can neither be imported nor
  // merged into. One cast here is better than loosening the whole call site.
  const pdfOptions = {
    margin: [0.4, 0.35, 0.4, 0.35],
    filename: safeFileName(options.name),
    image: { type: "jpeg", quality: 0.95 },
    html2canvas: {
      scale: options.scale ?? 1.5,
      useCORS: true,
      // Remote images that fail CORS otherwise blank the whole canvas.
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      // Capture from the top of the element regardless of page scroll.
      scrollX: 0,
      scrollY: 0,
      windowWidth: 794,
    },
    jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
    pagebreak: { mode: ["avoid-all", "css", "legacy"] },
  };

  try {
    const html2pdf = (await import("html2pdf.js")).default;
    const blob = (await html2pdf()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(pdfOptions as any)
      .from(element)
      .output("blob")) as Blob | undefined;

    // html2pdf resolves with `undefined` when the underlying canvas render
    // fails rather than rejecting, so an unchecked result travels all the way
    // to the share sheet as an empty attachment instead of an error anyone can
    // report.
    if (!(blob instanceof Blob) || blob.size === 0) {
      throw new Error("The document rendered blank. Please reopen this screen and try again.");
    }
    return blob;
  } catch (err) {
    console.error("[pdf] render failed:", err);
    throw new Error(pdfErrorMessage(err));
  }
}

/**
 * Render an element and hand the result to the user.
 *
 * On device this opens the Android share sheet with the real PDF attached
 * (WhatsApp, Gmail, Drive, Files…). On web it downloads normally.
 */
export async function exportElementAsPdf(
  element: HTMLElement | null,
  options: PdfOptions,
): Promise<SaveResult> {
  const fileName = safeFileName(options.name);
  if (!element) return { ok: false, fileName, error: "Nothing to export" };

  // Callers only inspect the SaveResult, so a throw from here would surface as
  // an unhandled rejection and the button would appear to do nothing.
  try {
    const blob = await elementToPdfBlob(element, options);

    const result = isNative
      ? await shareBlob(blob, fileName, {
          title: options.title,
          text: options.text,
          dialogTitle: options.title ?? "Share PDF",
        })
      : await saveBlob(blob, fileName);

    if (result.ok && isNative) await notify("PDF ready");
    return result;
  } catch (err) {
    return { ok: false, fileName, error: pdfErrorMessage(err) };
  }
}

/**
 * Render an arbitrary HTML string to a PDF (used by the payment receipt, which
 * has no live DOM node of its own).
 *
 * The capture host is positioned at 0,0 with opacity 0 rather than pushed off
 * screen with `left: -9999px` — html2canvas cannot rasterise a node outside the
 * viewport, which is why the previous approach produced blank pages.
 */
export async function htmlToPdfBlob(html: string, options: PdfOptions): Promise<Blob> {
  const host = document.createElement("div");
  host.className = "pdf-capture-host";
  host.innerHTML = html;
  document.body.appendChild(host);

  try {
    // Give the browser one frame to lay out and load any inline images.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    return await elementToPdfBlob(host, options);
  } finally {
    host.remove();
  }
}

export async function exportHtmlAsPdf(html: string, options: PdfOptions): Promise<SaveResult> {
  const fileName = safeFileName(options.name);

  try {
    const blob = await htmlToPdfBlob(html, options);

    const result = isNative
      ? await shareBlob(blob, fileName, {
          title: options.title,
          text: options.text,
          dialogTitle: options.title ?? "Share PDF",
        })
      : await saveBlob(blob, fileName);

    if (result.ok && isNative) await notify("PDF ready");
    return result;
  } catch (err) {
    return { ok: false, fileName, error: pdfErrorMessage(err) };
  }
}
