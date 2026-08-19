import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import ProductImage from "@/components/ProductImage";
import { productName, textList } from "@/lib/productData";

interface ProductViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Callers pass whatever the product row held, so this may be anything. */
  images: string[] | null | undefined;
  productName: string | null | undefined;
}

const ProductViewDialog = ({ open, onOpenChange, images, productName: name }: ProductViewDialogProps) => {
  const [idx, setIdx] = useState(0);
  const gallery = textList(images);
  const title = productName({ name });

  // Reopening the viewer should start at the first photo, not wherever the last
  // visit left off.
  useEffect(() => {
    if (open) setIdx(0);
  }, [open]);

  if (gallery.length === 0) return null;

  const currentIdx = Math.min(idx, gallery.length - 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl max-h-[85dvh] overflow-y-auto gap-0 p-0">
        {/* The title sits above the photo rather than under it so the dialog's
            close button always lands on a solid background instead of on top of
            an image, where it could vanish entirely. */}
        <DialogHeader className="space-y-0.5 border-b border-border px-4 py-3 pr-14 text-left">
          <DialogTitle className="truncate text-base sm:text-lg">{title}</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {gallery.length > 1 ? `Photo ${currentIdx + 1} of ${gallery.length}` : "Product photo"}
          </DialogDescription>
        </DialogHeader>

        <div className="relative bg-muted">
          <ProductImage
            src={gallery[currentIdx]}
            alt={`${title} — photo ${currentIdx + 1}`}
            objectFit="contain"
            className="h-[55dvh] w-full"
            iconClassName="h-12 w-12"
            label="Photo unavailable"
          />
          {gallery.length > 1 && (
            <>
              <Button
                size="icon"
                variant="secondary"
                aria-label="Previous photo"
                className="absolute left-2 top-1/2 h-11 w-11 -translate-y-1/2 rounded-full shadow-sm"
                onClick={() => setIdx((i) => (i - 1 + gallery.length) % gallery.length)}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                aria-label="Next photo"
                className="absolute right-2 top-1/2 h-11 w-11 -translate-y-1/2 rounded-full shadow-sm"
                onClick={() => setIdx((i) => (i + 1) % gallery.length)}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </>
          )}
        </div>

        {gallery.length > 1 && (
          <div className="flex flex-wrap items-center justify-center gap-1 border-t border-border p-2">
            {gallery.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Show photo ${i + 1}`}
                aria-current={i === currentIdx}
                className="flex h-11 w-8 items-center justify-center"
                onClick={() => setIdx(i)}
              >
                <span
                  className={`h-2 rounded-full transition-all ${i === currentIdx ? "w-5 bg-primary" : "w-2 bg-muted-foreground/40"}`}
                />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ProductViewDialog;
