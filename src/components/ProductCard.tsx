import { Tables } from "@/integrations/supabase/types";
import { useCart } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, Check, Plus, Minus, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { useState } from "react";
import ProductViewDialog from "@/components/ProductViewDialog";

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

  const handleAdd = () => {
    if (sizes.length > 0 && !selectedSize) return;
    if (features.length > 0 && !selectedFeature) return;
    addToCart(product, quantity, selectedSize, selectedFeature);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
    setQuantity(1);
  };

  const nextImage = () => setCurrentImageIdx((i) => (i + 1) % allImages.length);
  const prevImage = () => setCurrentImageIdx((i) => (i - 1 + allImages.length) % allImages.length);

  return (
    <>
      <Card className="group overflow-hidden hover:shadow-lg transition-all duration-300 border-border/50">
        <div className="aspect-square overflow-hidden bg-muted relative cursor-pointer" onClick={() => allImages.length > 0 && setViewOpen(true)}>
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
                    className="absolute left-1 top-1/2 -translate-y-1/2 bg-background/80 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); nextImage(); }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-background/80 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                    {allImages.map((_, i) => (
                      <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === currentImageIdx ? "bg-primary" : "bg-background/60"}`} />
                    ))}
                  </div>
                </>
              )}
              {/* View button */}
              <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button size="icon" variant="secondary" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); setViewOpen(true); }}>
                  <Eye className="h-4 w-4" />
                </Button>
              </div>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <ShoppingCart className="h-12 w-12 opacity-20" />
            </div>
          )}
          {product.is_trending && (
            <Badge className="absolute top-3 left-3 bg-primary text-primary-foreground">Trending</Badge>
          )}
        </div>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold text-base line-clamp-1">{product.name}</h3>
          {product.price > 0 && (
            <p className="text-sm font-semibold text-primary">₹{product.price}</p>
          )}
          {product.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">{product.description}</p>
          )}
          {product.category && (
            <Badge variant="outline" className="text-xs">{product.category}</Badge>
          )}

          {/* Feature selection FIRST */}
          {features.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Option</label>
              {features.length === 1 ? (
                <Badge variant="secondary" className="text-xs">{features[0]}</Badge>
              ) : (
                <Select value={selectedFeature || ""} onValueChange={(v) => { setSelectedFeature(v); setSelectedSize(null); }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select option" />
                  </SelectTrigger>
                  <SelectContent className="bg-card z-50">
                    {features.map((f) => (
                      <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Size selection - only show after feature is selected (if features exist) */}
          {sizes.length > 0 && (features.length === 0 || selectedFeature) && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Size</label>
              {sizes.length === 1 ? (
                <Badge variant="secondary" className="text-xs">{sizes[0]}</Badge>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {sizes.map((s) => {
                    const isOutOfStock = s.startsWith("~") || s.endsWith("~");
                    const displaySize = s.replace(/~/g, "").trim();
                    return (
                      <button
                        key={s}
                        disabled={isOutOfStock}
                        onClick={() => !isOutOfStock && setSelectedSize(s)}
                        className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                          isOutOfStock
                            ? "opacity-40 cursor-not-allowed line-through bg-muted text-muted-foreground border-border"
                            : selectedSize === s
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-card text-foreground border-border hover:border-primary"
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

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Quantity</label>
            <div className="flex items-center gap-2">
              <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setQuantity(Math.max(1, quantity - 1))}>
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-8 text-center font-medium text-sm">{quantity}</span>
              <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setQuantity(quantity + 1)}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => setViewOpen(true)}
            >
              <Eye className="h-4 w-4 mr-1" /> View
            </Button>
            <Button
              size="sm"
              className={`flex-1 ${added ? "bg-green-600 hover:bg-green-700" : ""}`}
              onClick={handleAdd}
              disabled={(sizes.length > 0 && !selectedSize) || (features.length > 0 && !selectedFeature)}
            >
              {added ? <Check className="h-4 w-4 mr-1" /> : <ShoppingCart className="h-4 w-4 mr-1" />}
              {added ? "Added!" : "Add"}
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
