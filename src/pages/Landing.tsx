import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { ArrowRight, Store, Share2, MessageSquare, Shield, Zap, Users } from "lucide-react";

const Landing = () => {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <header className="border-b bg-card/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <Store className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">CatalogShare</span>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" asChild>
              <Link to="/login">Login</Link>
            </Button>
            <Button asChild>
              <Link to="/register">Get Started</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-32 text-center">
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
            Your Wholesale Catalog,
            <span className="text-primary block mt-2">One Link Away</span>
          </h1>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Create your online product catalog in minutes. Share a single link with customers. 
            Receive orders directly on WhatsApp. Built for wholesalers.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Button size="lg" asChild>
              <Link to="/register">
                Create Your Catalog <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/login">I already have an account</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">How It Works</h2>
        <div className="grid sm:grid-cols-3 gap-8">
          {[
            { icon: Store, title: "1. Register & Set Up", desc: "Create your company profile with name, logo, contact details, and custom branding." },
            { icon: Share2, title: "2. Add Products & Share", desc: "Upload your product catalog and share a unique link with all your customers." },
            { icon: MessageSquare, title: "3. Receive Orders", desc: "Customers browse and send orders directly to your WhatsApp. Simple!" },
          ].map((f) => (
            <Card key={f.title} className="text-center border-border/50">
              <CardContent className="pt-8 pb-6 px-6">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <f.icon className="h-7 w-7 text-primary" />
                </div>
                <h3 className="font-bold text-lg mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Benefits */}
      <section className="bg-card border-y">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">Why CatalogShare?</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Zap, title: "Quick Setup", desc: "Get your catalog online in under 5 minutes." },
              { icon: Shield, title: "Admin Dashboard", desc: "Full control over your products, categories, and stock." },
              { icon: Users, title: "Customer Friendly", desc: "Customers browse and order without creating accounts." },
              { icon: Share2, title: "One Link", desc: "Share a single link for your entire catalog." },
              { icon: MessageSquare, title: "WhatsApp Orders", desc: "Orders come directly to your WhatsApp number." },
              { icon: Store, title: "Custom Branding", desc: "Your logo, your colors, your brand identity." },
            ].map((b) => (
              <div key={b.title} className="flex items-start gap-4 p-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <b.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{b.title}</h3>
                  <p className="text-sm text-muted-foreground">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold mb-4">Ready to digitize your catalog?</h2>
        <p className="text-muted-foreground mb-8">
          Join wholesalers who are already sharing their catalogs online. Free to get started.
        </p>
        <Button size="lg" asChild>
          <Link to="/register">
            Create Your Catalog Now <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </section>

      {/* Footer */}
      <footer className="border-t bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Store className="h-5 w-5 text-primary" />
              <span className="font-bold">CatalogShare</span>
            </div>
            <div className="text-sm text-muted-foreground flex gap-4">
              <Link to="/master-login" className="hover:text-foreground transition-colors">Admin</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
