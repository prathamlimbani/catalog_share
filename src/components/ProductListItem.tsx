import { Tables } from "@/integrations/supabase/types";
import { useCart } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, Check, Plus, Minus, Eye } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
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

const ProductListItem = ({ product }: { product: Product }) => {
  const { addToCart } = useCart();
  const [added, setAdded] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [viewOpen, setViewOpen] = useState(false);

  const name = productName(product);
  const allImages = useMemo(() => productImages(product), [product]);

  const globalSizes = splitList(product.size);
  const features = useMemo(() => productFeatures(product), [product]);
  // feature_sizes is JSONB from older builds, so it is parsed rather than cast.
  const { byFeature } = useMemo(() => parseFeatureSizes(product.feature_sizes), [product.feature_sizes]);
  const hasFeatureSizes = Object.keys(byFeature).length > 0;

  const [selectedFeature, setSelectedFeature] = useState<string | null>(features.length === 1 ? features[0] : null);

  const sizes = hasFeatureSizes && selectedFeature ? (byFeature[selectedFeature] ?? []) : globalSizes;

  const [selectedSize, setSelectedSize] = useState<string | null>(sizes.length === 1 ? sizes[0] : null);

  // Auto-select size when only one available
  useEffect(() => {
    if (sizes.length === 1) {
      setSelectedSize(sizes[0]);
    } else {
      setSelectedSize(null);
    }
  }, [selectedFeature, JSON.stringify(sizes)]);

  const price = Number(product.price) || 0;

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

  return (
    <>
      <Card className="overflow-hidden hover:shadow-md transition-shadow">
        <CardContent className="flex gap-3 p-3 sm:gap-4 sm:p-4">
          <button
            type="button"
            aria-label={allImages.length > 0 ? `View photos of ${name}` : name}
            disabled={allImages.length === 0}
            className="group relative h-20 w-20 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-muted disabled:cursor-default sm:h-24 sm:w-24"
            onClick={() => allImages.length > 0 && handleView()}
          >
            <ProductImage src={allImages[0]} alt={name} className="h-full w-full" iconClassName="h-8 w-8" />
            {allImages.length > 0 && (
              <span className="absolute inset-0 flex items-center justify-center bg-background/40 opacity-0 transition-opacity group-hover:opacity-100">
                <Eye className="h-5 w-5 text-foreground" />
              </span>
            )}
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="min-w-0 truncate font-semibold">{name}</h3>
                {product.is_trending && <Badge className="bg-primary text-primary-foreground text-xs">Trending</Badge>}
              </div>
              {asText(product.description).trim() && (
                <p className="mt-0.5 line-clamp-1 break-anywhere text-sm text-muted-foreground">{asText(product.description)}</p>
              )}
              {asText(product.category).trim() && <Badge variant="outline" className="mt-1 text-xs">{asText(product.category)}</Badge>}
              {price > 0 && (
                <p className="mt-1 text-sm font-semibold text-primary">₹{formatPrice(price)}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Feature first */}
              {features.length > 1 && (
                <Select value={selectedFeature || ""} onValueChange={(v) => { setSelectedFeature(v); setSelectedSize(null); }}>
                  <SelectTrigger className="h-11 w-24 text-sm">
                    <SelectValue placeholder="Option" />
                  </SelectTrigger>
                  <SelectContent className="bg-card z-50">
                    {features.map((f) => <SelectItem key={f} value={f} className="text-sm py-2.5">{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {/* Size after feature */}
              {sizes.length > 0 && (features.length === 0 || selectedFeature) && (
                sizes.length === 1 ? (
                  <div className="flex h-11 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground">
                    {sizeLabel(sizes[0])}
                  </div>
                ) : sizes.length > 3 ? (
                  <Select value={selectedSize || ""} onValueChange={setSelectedSize}>
                    <SelectTrigger className="h-11 w-24 text-sm sm:w-28">
                      <SelectValue placeholder="Size" />
                    </SelectTrigger>
                    <SelectContent className="bg-card z-50">
                      {sizes.map((s) => {
                        const soldOut = isSizeSoldOut(s);
                        return (
                          <SelectItem
                            key={s}
                            value={s}
                            disabled={soldOut}
                            className={`text-sm py-2.5 ${soldOut ? "opacity-50 line-through" : ""}`}
                          >
                            {sizeLabel(s)}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {sizes.map((s) => {
                      const soldOut = isSizeSoldOut(s);
                      return (
                        <button
                          key={s}
                          disabled={soldOut}
                          onClick={() => !soldOut && setSelectedSize(s)}
                          className={`h-11 min-w-[44px] rounded-md border px-2 text-xs transition-colors ${soldOut
                            ? "opacity-40 cursor-not-allowed line-through bg-muted text-muted-foreground border-border"
                            : selectedSize === s
                              ? "bg-primary text-primary-foreground border-primary font-medium"
                              : "bg-background text-foreground border-input hover:border-primary font-medium"
                            }`}
                        >
                          {sizeLabel(s)}
                        </button>
                      );
                    })}
                  </div>
                )
              )}

              <div className="flex items-center gap-1">
                <Button size="icon" variant="outline" aria-label="Decrease quantity" className="h-11 w-11 shrink-0" onClick={() => setQuantity(Math.max(1, quantity - 1))}>
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
                    className="h-11 w-14 rounded border border-input bg-background text-center text-base font-medium text-foreground"
                  />
                ) : (
                  <span className="w-8 text-center text-base font-medium">{quantity}</span>
                )}
                <Button size="icon" variant="outline" aria-label="Increase quantity" className="h-11 w-11 shrink-0" onClick={() => setQuantity(quantity + 1)}>
                  <Plus className="h-3 w-3" />
                </Button>
                {asText(product.quantity_unit).trim() && (
                  <span className="ml-0.5 min-w-0 truncate text-xs font-medium text-muted-foreground">{asText(product.quantity_unit)}</span>
                )}
              </div>

              <Button
                size="icon"
                className={`h-11 w-11 shrink-0 ${added ? "bg-emerald-600 hover:bg-emerald-600 text-primary-foreground" : "bg-primary hover:bg-primary/90 text-primary-foreground"}`}
                onClick={handleAdd}
                disabled={(sizes.length > 0 && !selectedSize) || (features.length > 0 && !selectedFeature)}
                title="Add to Cart"
                aria-label="Add to cart"
              >
                {added ? <Check className="h-5 w-5" /> : <ShoppingCart className="h-5 w-5" />}
              </Button>
            </div>
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

export default ProductListItem;
