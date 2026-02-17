import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ProductCard from "@/components/ProductCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, TrendingUp, Package } from "lucide-react";
import logo from "@/assets/logo_sve.png";

const Index = () => {
  const { data: trending, isLoading: trendingLoading } = useQuery({
    queryKey: ["products-trending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("is_trending", true)
        .eq("in_stock", true)
        .limit(8);
      if (error) throw error;
      return data;
    },
  });

  const { data: latest, isLoading: latestLoading } = useQuery({
    queryKey: ["products-latest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("in_stock", true)
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent">
        <div className="absolute inset-0 flex items-center justify-center opacity-[0.04] pointer-events-none">
          <img src={logo} alt="" className="w-[600px] max-w-[90vw] h-auto" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-32 relative z-10">
          <div className="flex flex-col items-center text-center">
            <img src={logo} alt="Sri Vijayalaxmi Enterprise" className="h-28 sm:h-36 w-auto mb-6" />
            <h1 className="text-2xl sm:text-4xl lg:text-6xl font-bold tracking-tight mb-6">
              Sri Vijayalaxmi
              <span className="text-primary block">Enterprise</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-lg">
              Your trusted wholesale partner. Browse our catalog, add items to your list, and send your order directly via WhatsApp.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Button size="lg" asChild>
                <Link to="/products">
                  Browse Products <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/cart">View Cart</Link>
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
            <Link to="/products">View All <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
        {trendingLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-xl" />
            ))}
          </div>
        ) : trending && trending.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {trending.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No trending products yet. Check back soon!</p>
          </div>
        )}
      </section>

      {/* Latest Products */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Package className="h-6 w-6 text-primary" />
            <h2 className="text-2xl sm:text-3xl font-bold">Latest Products</h2>
          </div>
          <Button variant="ghost" asChild>
            <Link to="/products">View All <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
        {latestLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-xl" />
            ))}
          </div>
        ) : latest && latest.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {latest.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No products yet. Admin can add products from the dashboard.</p>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src={logo} alt="SVE" className="h-10 w-auto" />
              <div className="text-center sm:text-left">
                <p className="font-bold">Sri Vijayalaxmi Enterprise</p>
                <p className="text-sm text-muted-foreground">Your trusted wholesale partner</p>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              <Link to="/admin" className="hover:text-foreground transition-colors">Admin</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
