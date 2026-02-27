import { Tables } from "@/integrations/supabase/types";
import { useCart } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, Check, Plus, Minus, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { useState, useEffect } from "react";
import ProductViewDialog from "@/components/ProductViewDialog";
import { supabase } from "@/integrations/supabase/client";

type Product = Tables<"products">;

const ProductCard = ({ product }: { product: Product }) => {
  const { addToCart } = useCart();
  const [added, setAdded] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [currentImageIdx, setCurrentImageIdx] = useState(0);
  const [viewOpen, setViewOpen] = useState(false);

  const allImages: string[] = [];
  if (product.image_url) allImages.push(product.image_url);
  if (product.images) {
    product.images.forEach((img) => { if (img && !allImages.includes(img)) allImages.push(img); });
  }

  const globalSizes = product.size ? product.size.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const features = product.features || [];
  const featureSizes = (product as any).feature_sizes as Record<string, string[]> | null;
  const hasFeatureSizes = featureSizes && Object.keys(featureSizes).length > 0;

  const [selectedFeature, setSelectedFeature] = useState<string | null>(
    features.length === 1 ? features[0] : null
  );

  const sizes = hasFeatureSizes && selectedFeature
    ? (featureSizes[selectedFeature] || [])
    : globalSizes;

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

  return (
    <>
      <Card className="group overflow-hidden hover:shadow-lg transition-all duration-300 border-border/50 flex flex-col h-full bg-card">
        <div className="aspect-square w-full overflow-hidden bg-muted relative cursor-pointer" onClick={() => allImages.length > 0 && handleView()}>
          {allImages.length > 0 ? (
            <>
              <img
                src={allImages[currentImageIdx]}
                alt={product.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                loading="lazy"
              />
              {allImages.length > 1 && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); prevImage(); }}
                    className="absolute left-1 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background rounded-full p-2 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                  >
                    <ChevronLeft className="h-4 w-4 text-foreground" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); nextImage(); }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background rounded-full p-2 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                  >
                    <ChevronRight className="h-4 w-4 text-foreground" />
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 bg-background/50 px-2 py-1.5 rounded-full backdrop-blur-sm">
                    {allImages.map((_, i) => (
                      <span key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === currentImageIdx ? "bg-primary w-3" : "bg-primary/40"}`} />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground/30 bg-secondary/30">
              <ShoppingCart className="h-12 w-12" />
            </div>
          )}
          {product.is_trending && (
            <Badge className="absolute top-3 left-3 bg-primary hover:bg-primary text-primary-foreground font-bold tracking-wider text-[10px] uppercase shadow-sm">Trending</Badge>
          )}
        </div>

        <CardContent className="p-4 sm:p-5 space-y-4 flex flex-col flex-1">
          <div className="space-y-1.5">
            <h3 className="font-bold text-base sm:text-lg line-clamp-2 leading-tight text-foreground">{product.name}</h3>
            {product.price > 0 && (
              <p className="text-sm font-bold text-primary">₹{product.price}</p>
            )}
            {product.description && (
              <p className="text-[13px] text-muted-foreground line-clamp-2">{product.description}</p>
            )}
          </div>

          <div className="flex-1 space-y-4">
            {/* Feature selection */}
            {features.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Option</label>
                {features.length === 1 ? (
                  <Badge variant="secondary" className="text-xs bg-secondary/50 text-foreground py-1 px-3 w-full justify-start rounded-lg border font-medium">
                    {features[0]}
                  </Badge>
                ) : (
                  <Select value={selectedFeature || ""} onValueChange={(v) => { setSelectedFeature(v); setSelectedSize(null); }}>
                    <SelectTrigger className="h-9 text-sm bg-background border-input text-foreground font-medium rounded-lg">
                      <SelectValue placeholder="Select option" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border z-50">
                      {features.map((f) => (
                        <SelectItem key={f} value={f} className="text-sm font-medium text-popover-foreground py-2 focus:bg-primary/10 focus:text-primary cursor-pointer transition-colors">
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
                  <Badge variant="secondary" className="text-xs bg-secondary/50 text-foreground py-1 px-3 font-medium rounded-lg border">
                    {sizes[0]}
                  </Badge>
                ) : sizes.length > 3 ? (
                  <Select value={selectedSize || ""} onValueChange={setSelectedSize}>
                    <SelectTrigger className="h-9 text-sm bg-background border-input text-foreground font-medium rounded-lg">
                      <SelectValue placeholder="Select size" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border z-50">
                      {sizes.map((s) => {
                        const isOutOfStock = s.startsWith("~") || s.endsWith("~");
                        const displaySize = s.replace(/~/g, "").trim();
                        return (
                          <SelectItem
                            key={s}
                            value={s}
                            disabled={isOutOfStock}
                            className={`text-sm font-medium py-2 focus:bg-primary/10 focus:text-primary cursor-pointer transition-colors ${isOutOfStock ? "opacity-50 line-through" : ""}`}
                          >
                            {displaySize}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {sizes.map((s) => {
                      const isOutOfStock = s.startsWith("~") || s.endsWith("~");
                      const displaySize = s.replace(/~/g, "").trim();
                      return (
                        <button
                          key={s}
                          disabled={isOutOfStock}
                          onClick={() => !isOutOfStock && setSelectedSize(s)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${isOutOfStock
                            ? "opacity-50 cursor-not-allowed line-through bg-muted/50 text-muted-foreground"
                            : selectedSize === s
                              ? "bg-primary text-primary-foreground border-primary shadow-sm"
                              : "bg-background text-foreground border-border hover:border-primary hover:bg-primary/10 hover:text-primary"
                            }`}
                        >
                          {displaySize}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quantity</label>
              <div className="flex items-center">
                <Button size="icon" variant="outline" className="h-8 w-8 rounded-l-lg rounded-r-none border-r-0 bg-background text-foreground" onClick={() => setQuantity(Math.max(1, quantity - 1))}>
                  <Minus className="h-3 w-3" />
                </Button>
                <div className="h-8 w-12 flex items-center justify-center font-semibold text-sm border-y border-input bg-background text-foreground">
                  {quantity}
                </div>
                <Button size="icon" variant="outline" className="h-8 w-8 rounded-r-lg rounded-l-none border-l-0 bg-background text-foreground" onClick={() => setQuantity(quantity + 1)}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          <div className="pt-2 mt-auto">
            <Button
              className={`w-full h-11 font-bold tracking-wide rounded-xl shadow-sm transition-all ${added ? "bg-green-600 hover:bg-green-700 text-white" : "bg-primary hover:bg-primary/90 text-primary-foreground"}`}
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
        productName={product.name}
      />
    </>
  );
};

export default ProductCard;
