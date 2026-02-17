import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ProductCard from "@/components/ProductCard";
import ProductListItem from "@/components/ProductListItem";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Search, X, LayoutGrid, List } from "lucide-react";

const Products = () => {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const { data: products, isLoading } = useQuery({
    queryKey: ["products-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("in_stock", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const categories = Array.from(
    new Set(products?.map((p) => p.category).filter(Boolean) as string[])
  ).sort();

  const filtered = products?.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.category && p.category.toLowerCase().includes(search.toLowerCase())) ||
      (p.description && p.description.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory = !selectedCategory || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-3xl font-bold">All Products</h1>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="icon"
              className="h-9 w-9 rounded-r-none"
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="icon"
              className="h-9 w-9 rounded-l-none"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <Button
            variant={selectedCategory === null ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedCategory(null)}
          >
            All
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat}
              variant={selectedCategory === cat ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
            >
              {cat}
              {selectedCategory === cat && <X className="ml-1 h-3 w-3" />}
            </Button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className={viewMode === "grid" ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" : "space-y-3"}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className={viewMode === "grid" ? "aspect-square rounded-xl" : "h-24 rounded-xl"} />
          ))}
        </div>
      ) : filtered && filtered.length > 0 ? (
        viewMode === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((p) => (
              <ProductListItem key={p.id} product={p} />
            ))}
          </div>
        )
      ) : (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg">No products found</p>
          {selectedCategory && (
            <Button variant="link" onClick={() => setSelectedCategory(null)} className="mt-2">
              Clear category filter
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default Products;
