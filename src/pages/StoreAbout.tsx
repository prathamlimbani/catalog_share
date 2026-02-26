import { useParams, Link } from "react-router-dom";
import { useCompanyBySlug } from "@/hooks/useCompany";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Store, Phone, MapPin, ArrowLeft, ShoppingCart, User, Menu, X } from "lucide-react";
import useStoreTheme from "@/hooks/useStoreTheme";
import ThemeToggle from "@/components/ThemeToggle";
import { useCart } from "@/contexts/CartContext";
import { useState } from "react";

const StoreAbout = () => {
    const { slug } = useParams<{ slug: string }>();
    const { data: company, isLoading } = useCompanyBySlug(slug || "");
    const { totalItems } = useCart();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useStoreTheme(company?.theme_primary || null, company?.theme_accent || null);

    if (isLoading) {
        return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
    }

    if (!company) {
        return (
            <div className="min-h-screen flex items-center justify-center text-center px-4">
                <div>
                    <Store className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-30" />
                    <h1 className="text-2xl font-bold mb-2">Store Not Found</h1>
                    <Button asChild><Link to="/">Go Home</Link></Button>
                </div>
            </div>
        );
    }

    const hasContactInfo = company.contact_name_1 || company.contact_name_2 || company.contact_phone_1 || company.contact_phone_2;
    const hasMapUrl = company.google_maps_url;

    // Extract embed URL from Google Maps share link
    const getEmbedUrl = (url: string) => {
        if (url.includes("embed")) return url;
        // Convert share link or place link to an embed search query
        const match = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (match) {
            return `https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d3000!2d${match[2]}!3d${match[1]}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e0!3m2!1sen!2sin!4v1`;
        }
        // If it's a place/search URL, use place search embed
        const encodedQuery = encodeURIComponent(url.replace(/https?:\/\/(www\.)?google\.com\/maps\/?/, ""));
        return `https://www.google.com/maps/embed/v1/place?key=&q=${encodedQuery}`;
    };

    return (
        <div className="min-h-screen">
            {/* Navbar */}
            <nav className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b overflow-x-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16 min-w-0">
                        <Link to={`/store/${slug}`} className="flex items-center gap-2 min-w-0 flex-shrink-0">
                            {company.logo_url ? (
                                <img src={company.logo_url} alt={company.name} className="h-10 w-auto flex-shrink-0" />
                            ) : (
                                <Store className="h-6 w-6 text-primary flex-shrink-0" />
                            )}
                            <span className="font-bold text-lg hidden sm:block truncate">{company.name}</span>
                        </Link>
                        <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
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
                            <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                            </Button>
                        </div>
                    </div>
                </div>
                {mobileMenuOpen && (
                    <div className="sm:hidden border-t bg-card p-4 space-y-2 animate-fade-in">
                        <Link to={`/store/${slug}`} onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm font-medium">Home</Link>
                        <Link to={`/store/${slug}/products`} onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm font-medium">Products</Link>
                        <Link to={`/store/${slug}/about`} onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm font-medium">About</Link>
                    </div>
                )}
            </nav>

            {/* Hero */}
            <section className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,hsl(var(--primary)/0.08),transparent_60%)]" />
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 text-center relative z-10">
                    {company.logo_url && (
                        <img src={company.logo_url} alt={company.name} className="h-24 sm:h-32 w-auto mx-auto mb-6 animate-fade-in-up" />
                    )}
                    <h1 className="text-3xl sm:text-4xl font-bold mb-3 animate-fade-in-up delay-100">About {company.name}</h1>
                    {company.address && (
                        <p className="text-muted-foreground flex items-center justify-center gap-2">
                            <MapPin className="h-4 w-4 flex-shrink-0" />
                            {company.address}
                        </p>
                    )}
                </div>
            </section>

            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <div className={`grid gap-6 ${hasMapUrl ? "lg:grid-cols-2" : "max-w-xl mx-auto"}`}>
                    {/* Contact Cards */}
                    <div className="space-y-4">
                        <h2 className="text-xl font-bold mb-4">Contact Information</h2>

                        {/* Main WhatsApp / Phone */}
                        <Card>
                            <CardContent className="p-5">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                        <Phone className="h-5 w-5 text-primary" />
                                    </div>
                                    <div>
                                        <p className="font-semibold">Main Contact</p>
                                        <a href={`tel:${company.phone}`} className="text-primary hover:underline text-sm">{company.phone}</a>
                                    </div>
                                </div>
                                {company.email && (
                                    <p className="text-sm text-muted-foreground">Email: {company.email}</p>
                                )}
                                {company.gst_number && (
                                    <p className="text-sm text-muted-foreground mt-1">GST: {company.gst_number}</p>
                                )}
                            </CardContent>
                        </Card>

                        {/* Contact 1 */}
                        {(company.contact_name_1 || company.contact_phone_1) && (
                            <Card>
                                <CardContent className="p-5">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                                            <User className="h-5 w-5 text-blue-500" />
                                        </div>
                                        <div>
                                            {company.contact_name_1 && <p className="font-semibold">{company.contact_name_1}</p>}
                                            {company.contact_phone_1 && (
                                                <a href={`tel:${company.contact_phone_1}`} className="text-primary hover:underline text-sm">
                                                    {company.contact_phone_1}
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {/* Contact 2 */}
                        {(company.contact_name_2 || company.contact_phone_2) && (
                            <Card>
                                <CardContent className="p-5">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                                            <User className="h-5 w-5 text-green-500" />
                                        </div>
                                        <div>
                                            {company.contact_name_2 && <p className="font-semibold">{company.contact_name_2}</p>}
                                            {company.contact_phone_2 && (
                                                <a href={`tel:${company.contact_phone_2}`} className="text-primary hover:underline text-sm">
                                                    {company.contact_phone_2}
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {!hasContactInfo && (
                            <p className="text-muted-foreground text-sm">No additional contacts added yet.</p>
                        )}
                    </div>

                    {/* Google Map */}
                    {hasMapUrl && (
                        <div className="space-y-4">
                            <h2 className="text-xl font-bold mb-4">Our Location</h2>
                            <Card className="overflow-hidden group hover:border-primary/50 transition-colors">
                                <CardContent className="p-8 text-center">
                                    <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                                        <MapPin className="h-8 w-8 text-primary" />
                                    </div>
                                    <h3 className="font-semibold text-lg mb-2">Find Us on the Map</h3>
                                    <p className="text-sm text-muted-foreground mb-4">Click below to view our location on Google Maps</p>
                                    <a
                                        href={company.google_maps_url!}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        <Button className="gap-2">
                                            <MapPin className="h-4 w-4" />
                                            Open in Google Maps
                                        </Button>
                                    </a>
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <footer className="border-t bg-card mt-8">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            {company.logo_url ? (
                                <img src={company.logo_url} alt={company.name} className="h-10 w-auto" />
                            ) : (
                                <Store className="h-5 w-5 text-primary" />
                            )}
                            <p className="font-bold">{company.name}</p>
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

export default StoreAbout;
