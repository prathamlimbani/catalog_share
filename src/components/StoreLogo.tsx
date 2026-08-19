import { useState } from "react";
import { Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { asText } from "@/lib/productData";

interface StoreLogoProps {
  url?: string | null;
  name?: string | null;
  /** Height utility for the image, e.g. "h-10". */
  className?: string;
  /** Size utilities for the fallback mark, e.g. "h-6 w-6". */
  fallbackClassName?: string;
}

/**
 * A store's logo, covering the two failure modes the storefront actually hits:
 * no logo saved at all, and a `logo_url` pointing at a file the merchant has
 * since deleted — which rendered a broken-image icon on every page of their
 * catalog with nothing to tell them it had happened.
 */
export function StoreLogo({ url, name, className = "h-10", fallbackClassName = "h-6 w-6" }: StoreLogoProps) {
  // Tracking the failed URL rather than a boolean means the fallback clears
  // itself the moment the merchant saves a new logo.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const src = asText(url).trim();

  if (!src || brokenSrc === src) {
    return <Store className={cn("shrink-0 text-primary", fallbackClassName)} aria-hidden="true" />;
  }

  return (
    <img
      src={src}
      alt={asText(name).trim() || "Store logo"}
      onError={() => setBrokenSrc(src)}
      className={cn("w-auto shrink-0 object-contain", className)}
    />
  );
}

export default StoreLogo;
