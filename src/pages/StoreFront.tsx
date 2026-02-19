import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyBySlug } from "@/hooks/useCompany";
import ProductCard from "@/components/ProductCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowRight, TrendingUp, Package, Store, ShoppingCart } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import ThemeToggle from "@/components/ThemeToggle";

const StoreFront = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: company, isLoading: companyLoading } = useCompanyBySlug(slug || "");
  const { totalItems } = useCart();

  const { data: trending, isLoading: trendingLoading } = useQuery({
    queryKey: ["store-trending", company?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("company_id", company!.id)
        .eq("is_trending", true)
        .eq("in_stock", true)
        .limit(8);
      if (error) throw error;
      return data;
    },
    enabled: !!company,
  });

  const { data: latest, isLoading: latestLoading } = useQuery({
    queryKey: ["store-latest", company?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("company_id", company!.id)
        .eq("in_stock", true)
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data;
    },
    enabled: !!company,
  });

  if (companyLoading) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading store...</p></div>;
  }

  if (!company) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-4">
        <div>
          <Store className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-30" />
          <h1 className="text-2xl font-bold mb-2">Store Not Found</h1>
          <p className="text-muted-foreground mb-6">This catalog doesn't exist or has been removed.</p>
          <Button asChild><Link to="/">Go Home</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Store Navbar */}
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
              <Link to={`/store/${slug}/products`} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden sm:block">Products</Link>
              <ThemeToggle />
              <Link to={`/store/${slug}/cart`} className="relative">
                <Button variant="outline" size="icon">
                  <ShoppingCart className="h-5 w-5" />
                </Button>
                {totalItems > 0 && (
                  <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                    {totalItems}
                  </span>
                )}
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-32 relative z-10">
          <div className="flex flex-col items-center text-center">
            {company.logo_url && (
              <img src={company.logo_url} alt={company.name} className="h-28 sm:h-36 w-auto mb-6" />
            )}
            <h1 className="text-2xl sm:text-4xl lg:text-6xl font-bold tracking-tight mb-6">
              {company.name}
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-lg">
              Browse our catalog, add items to your list, and send your order directly via WhatsApp.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Button size="lg" asChild>
                <Link to={`/store/${slug}/products`}>
                  Browse Products <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to={`/store/${slug}/cart`}>View Cart</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Trending */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <TrendingUp className="h-6 w-6 text-primary" />
            <h2 className="text-2xl sm:text-3xl font-bold">Trending Now</h2>
          </div>
          <Button variant="ghost" asChild>
            <Link to={`/store/${slug}/products`}>View All <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
        {trendingLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}
          </div>
        ) : trending && trending.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {trending.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No trending products yet.</p>
          </div>
        )}
      </section>

      {/* Latest */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Package className="h-6 w-6 text-primary" />
            <h2 className="text-2xl sm:text-3xl font-bold">Latest Products</h2>
          </div>
          <Button variant="ghost" asChild>
            <Link to={`/store/${slug}/products`}>View All <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
        {latestLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}
          </div>
        ) : latest && latest.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {latest.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No products yet. Check back soon!</p>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {company.logo_url ? (
                <img src={company.logo_url} alt={company.name} className="h-10 w-auto" />
              ) : (
                <Store className="h-5 w-5 text-primary" />
              )}
              <div className="text-center sm:text-left">
                <p className="font-bold">{company.name}</p>
                {company.phone && <p className="text-sm text-muted-foreground">WhatsApp: {company.phone}</p>}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Powered by <Link to="/" className="text-primary hover:underline">CatalogShare</Link>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default StoreFront;
