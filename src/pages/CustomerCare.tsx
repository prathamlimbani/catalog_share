import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Mail, Heart, PhoneCall, ShieldCheck, Clock } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const CustomerCare = () => {
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

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-accent/20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center relative z-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-6 animate-pulse">
            <Heart className="h-8 w-8 fill-primary/20" />
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">
            We Truly Care About You
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Your success is our success. At CatalogShare, we don't just provide a platform; we provide a partnership. Whenever you need help, we're just a click away.
          </p>
        </div>
      </section>

      {/* How We Care Section */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid md:grid-cols-3 gap-8">
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                <Clock className="h-6 w-6 text-blue-500" />
              </div>
              <h3 className="font-bold text-lg mb-2">Fast Response</h3>
              <p className="text-sm text-muted-foreground">We aim to respond to all inquiries as swiftly as possible because we know your business runs fast.</p>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                <ShieldCheck className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="font-bold text-lg mb-2">Reliable Support</h3>
              <p className="text-sm text-muted-foreground">Our engineers directly look at your issues ensuring you get accurate and helpful technical support.</p>
            </CardContent>
          </Card>
          <Card className="border-primary/20 bg-card/50 backdrop-blur-sm relative overflow-hidden ring-1 ring-primary/20 hover:shadow-md transition-shadow">
            <div className="absolute top-0 right-0 bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-bl-lg">
              PRO / SUPPORT
            </div>
            <CardContent className="p-6 text-center">
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
                <PhoneCall className="h-6 w-6 text-purple-500" />
              </div>
              <h3 className="font-bold text-lg mb-2">Direct Call Support</h3>
              <p className="text-sm text-muted-foreground">Premium and Support Plan members get priority phone assistance directly from our team for critical issues.</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Contact Action Section */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 text-center">
        <div className="bg-primary/5 rounded-3xl p-8 sm:p-12 border border-primary/10 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-primary to-purple-500" />
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">Ready to Talk?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Whether you have a simple question, found a bug, or need help setting up your catalog, our inbox is always open.
          </p>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
            <Button asChild size="lg" className="rounded-full gap-2 px-8 w-full sm:w-auto shadow-lg shadow-primary/25">
              <a href="mailto:catalogshare123@gmail.com?subject=Customer%20Care%20Request">
                <Mail className="h-5 w-5" />
                Email Support Team
              </a>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-full px-8 w-full sm:w-auto">
              <Link to="/pricing">View Premium Plans</Link>
            </Button>
          </div>
          <div className="mt-6 inline-flex items-center justify-center gap-2 text-sm text-muted-foreground bg-background/80 rounded-full px-4 py-2 shadow-sm border backdrop-blur-sm">
            <span>Direct Email:</span>
            <span className="font-semibold text-foreground">catalogshare123@gmail.com</span>
          </div>
        </div>
      </section>
    </div>
  );
};

export default CustomerCare;
