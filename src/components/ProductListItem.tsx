import { Tables } from "@/integrations/supabase/types";
import { useCart } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, Check, Plus, Minus, Package, Eye } from "lucide-react";
import { useState } from "react";
import ProductViewDialog from "@/components/ProductViewDialog";

type Product = Tables<"products">;

const ProductListItem = ({ product }: { product: Product }) => {
  const { addToCart } = useCart();
  const [added, setAdded] = useState(false);
  const [quantity, setQuantity] = useState(1);
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

  const [selectedFeature, setSelectedFeature] = useState<string | null>(features.length === 1 ? features[0] : null);

  const sizes = hasFeatureSizes && selectedFeature
    ? (featureSizes[selectedFeature] || [])
    : globalSizes;

  const [selectedSize, setSelectedSize] = useState<string | null>(sizes.length === 1 ? sizes[0] : null);

  const mainImage = product.image_url || (product.images && product.images[0]);

  const handleAdd = () => {
    if (sizes.length > 0 && !selectedSize) return;
    if (features.length > 0 && !selectedFeature) return;
    addToCart(product, quantity, selectedSize, selectedFeature);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
    setQuantity(1);
  };

  return (
    <>
      <Card className="overflow-hidden hover:shadow-md transition-shadow">
        <CardContent className="p-3 sm:p-4 flex gap-3 sm:gap-4">
          <div
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg overflow-hidden bg-muted flex-shrink-0 cursor-pointer relative group"
            onClick={() => allImages.length > 0 && setViewOpen(true)}
          >
            {mainImage ? (
              <>
                <img src={mainImage} alt={product.name} className="w-full h-full object-cover" loading="lazy" />
                <div className="absolute inset-0 bg-background/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Eye className="h-5 w-5" />
                </div>
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package className="h-8 w-8 opacity-20" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold truncate">{product.name}</h3>
                {product.is_trending && <Badge className="bg-primary text-primary-foreground text-xs">Trending</Badge>}
              </div>
              {product.description && (
                <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{product.description}</p>
              )}
              {product.category && <Badge variant="outline" className="text-xs mt-1">{product.category}</Badge>}
              {product.price > 0 && (
                <p className="text-sm font-semibold text-primary mt-1">₹{product.price}</p>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Feature first */}
              {features.length > 1 && (
                <Select value={selectedFeature || ""} onValueChange={(v) => { setSelectedFeature(v); setSelectedSize(null); }}>
                  <SelectTrigger className="h-8 text-xs w-24">
                    <SelectValue placeholder="Option" />
                  </SelectTrigger>
                  <SelectContent className="bg-card z-50">
                    {features.map((f) => <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {/* Size after feature */}
              {sizes.length > 1 && (features.length === 0 || selectedFeature) && (
                <div className="flex flex-wrap gap-1">
                  {sizes.map((s) => {
                    const isOutOfStock = s.startsWith("~") || s.endsWith("~");
                    const displaySize = s.replace(/~/g, "").trim();
                    return (
                      <button
                        key={s}
                        disabled={isOutOfStock}
                        onClick={() => !isOutOfStock && setSelectedSize(s)}
                        className={`px-2 py-0.5 text-xs rounded border transition-colors ${
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

              <div className="flex items-center gap-1">
                <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setQuantity(Math.max(1, quantity - 1))}>
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="w-6 text-center font-medium text-sm">{quantity}</span>
                <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setQuantity(quantity + 1)}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <Button
                size="sm"
                className={added ? "bg-green-600 hover:bg-green-700" : ""}
                onClick={handleAdd}
                disabled={(sizes.length > 0 && !selectedSize) || (features.length > 0 && !selectedFeature)}
              >
                {added ? <Check className="h-4 w-4 mr-1" /> : <ShoppingCart className="h-4 w-4 mr-1" />}
                {added ? "Added!" : "Add"}
              </Button>
            </div>
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

export default ProductListItem;
