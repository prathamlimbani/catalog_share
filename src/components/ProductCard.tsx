import { Tables } from "@/integrations/supabase/types";
import { useCart } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, Check, Plus, Minus, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useEffect, useMemo, memo } from "react";
import ProductViewDialog from "@/components/ProductViewDialog";
import ProductImage from "@/components/ProductImage";
import { supabase } from "@/integrations/supabase/client";
import {
  asText,
  formatPrice,
  isSizeSoldOut,
  parseFeatureSizes,
  productFeatures,
  productImages,
  productName,
  sizeLabel,
  splitList,
} from "@/lib/productData";

type Product = Tables<"products">;

const ProductCard = ({ product }: { product: Product }) => {
  const { addToCart } = useCart();
  const [added, setAdded] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [currentImageIdx, setCurrentImageIdx] = useState(0);
  const [viewOpen, setViewOpen] = useState(false);

  const name = productName(product);
  const allImages = useMemo(() => productImages(product), [product]);

  const globalSizes = splitList(product.size);
  const features = useMemo(() => productFeatures(product), [product]);
  // feature_sizes is JSONB from older builds, so it is parsed rather than cast.
  const { byFeature } = useMemo(() => parseFeatureSizes(product.feature_sizes), [product.feature_sizes]);
  const hasFeatureSizes = Object.keys(byFeature).length > 0;

  const [selectedFeature, setSelectedFeature] = useState<string | null>(
    features.length === 1 ? features[0] : null
  );

  const sizes = hasFeatureSizes && selectedFeature ? (byFeature[selectedFeature] ?? []) : globalSizes;

  const [selectedSize, setSelectedSize] = useState<string | null>(
    sizes.length === 1 ? sizes[0] : null
  );

  // Auto-select size when only one available (e.g., after variant change)
  useEffect(() => {
    if (sizes.length === 1) {
      setSelectedSize(sizes[0]);
    } else {
      setSelectedSize(null);
    }
  }, [selectedFeature, JSON.stringify(sizes)]);

  // A gallery that shrinks (a deleted photo) must not leave the index past the end.
  const imageIdx = allImages.length > 0 ? Math.min(currentImageIdx, allImages.length - 1) : 0;

  const handleAdd = () => {
    if (sizes.length > 0 && !selectedSize) return;
    if (features.length > 0 && !selectedFeature) return;
    addToCart(product, quantity, selectedSize, selectedFeature);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
    setQuantity(1);
  };

  const handleView = () => {
    supabase.from("analytics_events").insert({
      event_type: "product_click",
      page_url: window.location.pathname,
      company_id: product.company_id,
      product_id: product.id,
    }).then(({ error }) => {
      if (error) console.error("Failed to track product click", error);
    });
    setViewOpen(true);
  };

  const nextImage = () => setCurrentImageIdx((i) => (i + 1) % allImages.length);
  const prevImage = () => setCurrentImageIdx((i) => (i - 1 + allImages.length) % allImages.length);

  const price = Number(product.price) || 0;

  return (
    <>
      <Card className="group overflow-hidden hover:shadow-lg transition-all duration-300 border-border/50 flex flex-col h-full bg-card">
        <div
          className="aspect-square w-full overflow-hidden bg-muted relative cursor-pointer"
          onClick={() => allImages.length > 0 && handleView()}
        >
          <ProductImage
            src={allImages[imageIdx]}
            alt={name}
            className="h-full w-full transition-transform duration-500 group-hover:scale-105"
            iconClassName="h-10 w-10"
            label="No photo yet"
          />
          {allImages.length > 1 && (
            <>
              {/* Hover-only arrows, hidden below sm: on a touch screen they were
                  invisible but still tappable, so an edge tap swapped the photo
                  instead of opening the viewer. */}
              <button
                aria-label="Previous photo"
                onClick={(e) => { e.stopPropagation(); prevImage(); }}
                className="absolute left-1 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 opacity-0 shadow-sm transition-all hover:bg-background group-hover:opacity-100 sm:flex"
              >
                <ChevronLeft className="h-4 w-4 text-foreground" />
              </button>
              <button
                aria-label="Next photo"
                onClick={(e) => { e.stopPropagation(); nextImage(); }}
                className="absolute right-1 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 opacity-0 shadow-sm transition-all hover:bg-background group-hover:opacity-100 sm:flex"
              >
                <ChevronRight className="h-4 w-4 text-foreground" />
              </button>
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-background/60 px-2 py-1.5 backdrop-blur-sm">
                {allImages.map((_, i) => (
                  <span key={i} className={`h-1.5 rounded-full transition-all ${i === imageIdx ? "w-3 bg-primary" : "w-1.5 bg-primary/40"}`} />
                ))}
              </div>
            </>
          )}
          {product.is_trending && (
            <Badge className="absolute top-3 left-3 bg-primary hover:bg-primary text-primary-foreground font-bold tracking-wider text-[10px] uppercase shadow-sm">Trending</Badge>
          )}
        </div>

        <CardContent className="flex flex-1 flex-col space-y-4 p-3 sm:p-5">
          <div className="min-w-0 space-y-1.5">
            <h3 className="font-bold text-base sm:text-lg line-clamp-2 leading-tight text-foreground break-anywhere">{name}</h3>
            {price > 0 && (
              <p className="text-sm font-bold text-primary">₹{formatPrice(price)}</p>
            )}
            {asText(product.description).trim() && (
              <p className="text-[13px] text-muted-foreground line-clamp-2 break-anywhere">{asText(product.description)}</p>
            )}
          </div>

          <div className="flex-1 space-y-4">
            {/* Feature selection */}
            {features.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Option</label>
                {features.length === 1 ? (
                  <Badge variant="secondary" className="text-xs bg-secondary/50 text-foreground py-1 px-3 w-full justify-start rounded-lg border font-medium break-anywhere">
                    {features[0]}
                  </Badge>
                ) : (
                  <Select value={selectedFeature || ""} onValueChange={(v) => { setSelectedFeature(v); setSelectedSize(null); }}>
                    <SelectTrigger className="h-11 text-sm bg-background border-input text-foreground font-medium rounded-lg">
                      <SelectValue placeholder="Select option" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border z-50">
                      {features.map((f) => (
                        <SelectItem key={f} value={f} className="text-sm font-medium text-popover-foreground py-2.5 focus:bg-primary/10 focus:text-primary cursor-pointer transition-colors">
                          {f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Size selection  */}
            {sizes.length > 0 && (features.length === 0 || selectedFeature) && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Size</label>
                {sizes.length === 1 ? (
                  <Badge variant="secondary" className="text-xs bg-secondary/50 text-foreground py-1 px-3 font-medium rounded-lg border break-anywhere">
                    {sizeLabel(sizes[0])}
                  </Badge>
                ) : sizes.length > 3 ? (
                  <Select value={selectedSize || ""} onValueChange={setSelectedSize}>
                    <SelectTrigger className="h-11 text-sm bg-background border-input text-foreground font-medium rounded-lg">
                      <SelectValue placeholder="Select size" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border z-50">
                      {sizes.map((s) => {
                        const soldOut = isSizeSoldOut(s);
                        return (
                          <SelectItem
                            key={s}
                            value={s}
                            disabled={soldOut}
                            className={`text-sm font-medium py-2.5 focus:bg-primary/10 focus:text-primary cursor-pointer transition-colors ${soldOut ? "opacity-50 line-through" : ""}`}
                          >
                            {sizeLabel(s)}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {sizes.map((s) => {
                      const soldOut = isSizeSoldOut(s);
                      return (
                        <button
                          key={s}
                          disabled={soldOut}
                          onClick={() => !soldOut && setSelectedSize(s)}
                          className={`min-h-[44px] min-w-[44px] break-anywhere rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${soldOut
                            ? "opacity-50 cursor-not-allowed line-through bg-muted/50 text-muted-foreground"
                            : selectedSize === s
                              ? "bg-primary text-primary-foreground border-primary shadow-sm"
                              : "bg-background text-foreground border-border hover:border-primary hover:bg-primary/10 hover:text-primary"
                            }`}
                        >
                          {sizeLabel(s)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quantity</label>
                {asText(product.quantity_unit).trim() && (
                  <span className="mt-0.5 min-w-0 truncate text-xs font-medium text-muted-foreground">{asText(product.quantity_unit)}</span>
                )}
              </div>
              {/* The stepper is width-driven, not fixed: at 360px this card is
                  ~124px wide inside a two-column grid, so the readout shrinks
                  while the two 44px targets stay put. */}
              <div className="flex w-full items-center">
                <Button size="icon" variant="outline" aria-label="Decrease quantity" className="h-11 w-11 shrink-0 rounded-l-lg rounded-r-none border-r-0 bg-background text-foreground" onClick={() => setQuantity(Math.max(1, quantity - 1))}>
                  <Minus className="h-3 w-3" />
                </Button>
                {product.allow_custom_quantity ? (
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    aria-label="Quantity"
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    className="z-10 h-11 min-w-0 flex-1 border border-x-0 border-y-input bg-background px-1 text-center text-base font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                ) : (
                  <div className="flex h-11 min-w-0 flex-1 items-center justify-center border-y border-input bg-background text-base font-semibold text-foreground">
                    {quantity}
                  </div>
                )}
                <Button size="icon" variant="outline" aria-label="Increase quantity" className="h-11 w-11 shrink-0 rounded-l-none rounded-r-lg border-l-0 bg-background text-foreground" onClick={() => setQuantity(quantity + 1)}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          <div className="pt-2 mt-auto">
            <Button
              className={`w-full h-11 font-bold tracking-wide rounded-xl shadow-sm transition-all ${added ? "bg-emerald-600 hover:bg-emerald-600 text-primary-foreground" : "bg-primary hover:bg-primary/90 text-primary-foreground"}`}
              onClick={handleAdd}
              disabled={(sizes.length > 0 && !selectedSize) || (features.length > 0 && !selectedFeature)}
            >
              {added ? (
                <>
                  <Check className="h-5 w-5 mr-2" /> Added
                </>
              ) : (
                <>
                  <ShoppingCart className="h-5 w-5 mr-2" /> Add to Cart
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ProductViewDialog
        open={viewOpen}
        onOpenChange={setViewOpen}
        images={allImages}
        productName={name}
      />
    </>
  );
};

export default memo(ProductCard);
