import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { asText } from "@/lib/productData";

interface ProductImageProps {
  /** May be null, blank, or a URL whose file was deleted from storage. */
  src: string | null | undefined;
  alt: string;
  /** Classes for the <img> and for the placeholder that replaces it. */
  className?: string;
  /** Size of the placeholder glyph, e.g. "h-8 w-8". */
  iconClassName?: string;
  /** Rendered under the glyph when there is nothing to show. */
  label?: string;
  objectFit?: "cover" | "contain";
}

/**
 * A product image that always renders something.
 *
 * A missing `image_url` and a URL that 404s look identical to a customer — both
 * used to leave a torn-page icon or an empty box — so both fall back to the same
 * branded placeholder here.
 */
const ProductImage = ({
  src,
  alt,
  className,
  iconClassName = "h-8 w-8",
  label,
  objectFit = "cover",
}: ProductImageProps) => {
  const url = asText(src).trim();
  const [failed, setFailed] = useState(false);

  // A recycled card (same DOM node, new product) must retry the new URL.
  useEffect(() => setFailed(false), [url]);

  if (!url || failed) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground/50",
          className,
        )}
        role="img"
        aria-label={`${alt} — no image`}
      >
        <Package className={iconClassName} aria-hidden="true" />
        {label && <span className="px-1 text-center text-[10px] font-medium leading-tight">{label}</span>}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn(objectFit === "cover" ? "object-cover" : "object-contain", className)}
    />
  );
};

export default ProductImage;
