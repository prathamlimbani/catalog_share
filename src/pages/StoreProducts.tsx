import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyBySlug } from "@/hooks/useCompany";
import ProductCard from "@/components/ProductCard";
import ProductListItem from "@/components/ProductListItem";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Search, X, LayoutGrid, List, Store, ShoppingCart, ArrowLeft } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import ThemeToggle from "@/components/ThemeToggle";

const StoreProducts = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: company, isLoading: companyLoading } = useCompanyBySlug(slug || "");
  const { totalItems } = useCart();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const { data: products, isLoading } = useQuery({
    queryKey: ["store-products", company?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("company_id", company!.id)
        .eq("in_stock", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!company,
  });

  if (companyLoading) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  }

  if (!company) {
    return <div className="min-h-screen flex items-center justify-center"><p>Store not found.</p></div>;
  }

  const categories = Array.from(
    new Set(products?.map((p) => p.category).filter(Boolean) as string[])
  ).sort();

  const filtered = products?.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.category && p.category.toLowerCase().includes(search.toLowerCase())) ||
      (p.description && p.description.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory = !selectedCategory || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to={`/store/${slug}`} className="flex items-center gap-2">
              {company.logo_url ? (
                <img src={company.logo_url} alt={company.name} className="h-10 w-auto" />
              ) : (
                <Store className="h-6 w-6 text-primary" />
              )}
              <span className="font-bold text-lg hidden sm:block">{company.name}</span>
            </Link>
            <div className="flex items-center gap-3">
              <Link to={`/store/${slug}`} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden sm:block">Home</Link>
              <ThemeToggle />
              <Link to={`/store/${slug}/cart`} className="relative">
                <Button variant="outline" size="icon">
                  <ShoppingCart className="h-5 w-5" />
                </Button>
                {totalItems > 0 && (
                  <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">{totalItems}</span>
                )}
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <h1 className="text-3xl font-bold">All Products</h1>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
            </div>
            <div className="flex border rounded-md">
              <Button variant={viewMode === "grid" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-r-none" onClick={() => setViewMode("grid")}>
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button variant={viewMode === "list" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-l-none" onClick={() => setViewMode("list")}>
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <Button variant={selectedCategory === null ? "default" : "outline"} size="sm" onClick={() => setSelectedCategory(null)}>All</Button>
            {categories.map((cat) => (
              <Button key={cat} variant={selectedCategory === cat ? "default" : "outline"} size="sm" onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}>
                {cat}{selectedCategory === cat && <X className="ml-1 h-3 w-3" />}
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
              {filtered.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((p) => <ProductListItem key={p.id} product={p} />)}
            </div>
          )
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-lg">No products found</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default StoreProducts;
