import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface ProductViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: string[];
  productName: string;
}

const ProductViewDialog = ({ open, onOpenChange, images, productName }: ProductViewDialogProps) => {
  const [idx, setIdx] = useState(0);

  if (images.length === 0) return null;

  const currentIdx = Math.min(idx, images.length - 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden bg-background border-border">
        <div className="relative">
          <img
            src={images[currentIdx]}
            alt={`${productName} - Image ${currentIdx + 1}`}
            className="w-full max-h-[80vh] object-contain bg-muted"
          />
          {images.length > 1 && (
            <>
              <Button
                size="icon"
                variant="secondary"
                className="absolute left-2 top-1/2 -translate-y-1/2"
                onClick={() => setIdx((i) => (i - 1 + images.length) % images.length)}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                className="absolute right-2 top-1/2 -translate-y-1/2"
                onClick={() => setIdx((i) => (i + 1) % images.length)}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </>
          )}
          <div className="absolute top-2 right-2">
            <Button size="icon" variant="secondary" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {images.length > 1 && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
              {images.map((_, i) => (
                <button
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${i === currentIdx ? "bg-primary" : "bg-muted-foreground/40"}`}
                  onClick={() => setIdx(i)}
                />
              ))}
            </div>
          )}
        </div>
        <div className="p-4">
          <h3 className="font-semibold text-lg">{productName}</h3>
          {images.length > 1 && (
            <p className="text-sm text-muted-foreground">{currentIdx + 1} of {images.length}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProductViewDialog;
