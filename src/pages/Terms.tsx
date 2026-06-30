import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const Terms = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <header className="border-b bg-card/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="CatalogShare Logo" className="h-10 sm:h-12 w-auto object-contain flex-shrink-0" />
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button variant="ghost" asChild>
              <Link to="/">
                <ArrowLeft className="h-4 w-4 mr-1" /> Home
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12 sm:py-16">
        <h1 className="text-3xl sm:text-4xl font-bold mb-8">Terms & Conditions</h1>
        
        <div className="prose prose-slate dark:prose-invert max-w-none space-y-6 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Acceptance of Terms</h2>
            <p>By accessing and using CatalogShare, you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by the above, please do not use this service.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. Service Description</h2>
            <p>CatalogShare provides businesses with tools to create online product catalogs, share links, and receive orders via WhatsApp. We reserve the right to modify, suspend or discontinue any part of the service at any time.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">3. User Accounts</h2>
            <p>You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must notify us immediately of any unauthorized use of your account.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. Content Guidelines</h2>
            <p>You retain all rights to the product images and details you upload. However, you agree not to upload any content that is illegal, offensive, or violates intellectual property rights.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. Payments & Subscriptions</h2>
            <p>Subscription fees are billed in advance on a monthly basis. All payments are non-refundable unless otherwise required by law. We reserve the right to change our pricing upon providing reasonable notice.</p>
          </section>
        </div>
      </main>
    </div>
  );
};

export default Terms;
