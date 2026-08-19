import { useParams, Link } from "react-router-dom";
import { useCompanyBySlug } from "@/hooks/useCompany";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Store, Phone, MapPin, ShoppingCart, User, Menu, X, CreditCard, Mail } from "lucide-react";
import useStoreTheme from "@/hooks/useStoreTheme";
import ThemeToggle from "@/components/ThemeToggle";
import StoreLogo from "@/components/StoreLogo";
import { useCart } from "@/contexts/CartContext";
import { useState } from "react";
import { asText } from "@/lib/productData";
import { phoneDigits, safeExternalUrl, storeName } from "@/lib/storefront";

const StoreAbout = () => {
    const { slug } = useParams<{ slug: string }>();
    const { data: company, isLoading } = useCompanyBySlug(slug || "");
    // Scoped to this store so the badge matches the basket the customer will send.
    const { totalItems } = useCart(slug);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useStoreTheme(company?.theme_primary || null, company?.theme_accent || null);

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background px-4">
                <p className="text-muted-foreground">Loading...</p>
            </div>
        );
    }

    if (!company) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center text-foreground">
                <div>
                    <Store className="mx-auto mb-4 h-16 w-16 text-muted-foreground opacity-30" />
                    <h1 className="mb-2 text-2xl font-bold">Store not found</h1>
                    <p className="mb-6 text-muted-foreground">This catalog doesn't exist or has been removed.</p>
                    <Button asChild className="h-11">
                        <Link to="/">Go home</Link>
                    </Button>
                </div>
            </div>
        );
    }

    // Every field below is nullable, so each one is read through asText() before
    // anything calls a string method on it or drops it into an href.
    const name = storeName(company);
    const address = asText(company.address).trim();
    const gstNumber = asText(company.gst_number).trim();
    const email = asText(company.email).trim();
    const mainPhone = asText(company.phone).trim();
    const contactName1 = asText(company.contact_name_1).trim();
    const contactPhone1 = asText(company.contact_phone_1).trim();
    const contactName2 = asText(company.contact_name_2).trim();
    const contactPhone2 = asText(company.contact_phone_2).trim();
    const upiId = asText(company.upi_id).trim();
    const upiQrUrl = asText(company.upi_qr_url).trim();
    // Merchants paste whatever Google gave them; anything that is not http(s)
    // never reaches the href.
    const mapsUrl = safeExternalUrl(company.google_maps_url);

    const hasExtraContacts = !!(contactName1 || contactName2 || contactPhone1 || contactPhone2);
    const hasUpiInfo = !!(upiId || upiQrUrl);
    const hasAnyDetail = !!(address || gstNumber || email || mainPhone || hasExtraContacts || mapsUrl || hasUpiInfo);

    return (
        <div className="min-h-screen bg-background text-foreground">
            {/* Navbar */}
            <nav className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    <div className="flex h-16 min-w-0 items-center justify-between gap-3">
                        <Link to={`/store/${slug}`} className="flex min-w-0 items-center gap-2">
                            <StoreLogo url={company.logo_url} name={name} className="h-9 sm:h-10" />
                            <span className="hidden truncate text-lg font-bold sm:block">{name}</span>
                        </Link>
                        <div className="flex flex-shrink-0 items-center gap-1 sm:gap-3">
                            <Link
                                to={`/store/${slug}`}
                                className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
                            >
                                Home
                            </Link>
                            <Link
                                to={`/store/${slug}/products`}
                                className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
                            >
                                Products
                            </Link>
                            <ThemeToggle />
                            <Link to={`/store/${slug}/cart`} className="relative" aria-label={`Cart, ${totalItems} items`}>
                                <Button variant="outline" size="icon" className="h-11 w-11">
                                    <ShoppingCart className="h-5 w-5" />
                                </Button>
                                {totalItems > 0 && (
                                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                                        {totalItems}
                                    </span>
                                )}
                            </Link>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-11 w-11 sm:hidden"
                                aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
                                aria-expanded={mobileMenuOpen}
                                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            >
                                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                            </Button>
                        </div>
                    </div>
                </div>
                {mobileMenuOpen && (
                    <div className="absolute left-0 top-full w-full animate-fade-in space-y-1 border-t bg-card p-4 shadow-lg sm:hidden">
                        <Link
                            to={`/store/${slug}`}
                            onClick={() => setMobileMenuOpen(false)}
                            className="flex min-h-11 items-center text-[15px] font-medium hover:text-primary"
                        >
                            Home
                        </Link>
                        <Link
                            to={`/store/${slug}/products`}
                            onClick={() => setMobileMenuOpen(false)}
                            className="flex min-h-11 items-center text-[15px] font-medium hover:text-primary"
                        >
                            Products
                        </Link>
                        <Link
                            to={`/store/${slug}/about`}
                            onClick={() => setMobileMenuOpen(false)}
                            className="flex min-h-11 items-center text-[15px] font-medium hover:text-primary"
                        >
                            About
                        </Link>
                    </div>
                )}
            </nav>

            {/* Hero */}
            <section className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,hsl(var(--primary)/0.08),transparent_60%)]" />
                <div className="relative z-10 mx-auto max-w-4xl px-4 py-12 text-center sm:px-6 sm:py-20 lg:px-8">
                    {company.logo_url && (
                        <StoreLogo
                            url={company.logo_url}
                            name={name}
                            className="mx-auto mb-6 h-20 animate-fade-in-up sm:h-32"
                            fallbackClassName="mx-auto mb-6 h-16 w-16"
                        />
                    )}
                    <h1 className="delay-100 mb-3 animate-fade-in-up break-anywhere text-2xl font-bold sm:text-4xl">
                        About {name}
                    </h1>
                    {address && (
                        <p className="mb-2 flex items-start justify-center gap-2 text-muted-foreground">
                            <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <span className="break-anywhere text-left">{address}</span>
                        </p>
                    )}
                    {gstNumber && (
                        <p className="break-anywhere font-medium text-muted-foreground">GST IN: {gstNumber}</p>
                    )}
                </div>
            </section>

            <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
                {!hasAnyDetail ? (
                    <div className="mx-auto max-w-md py-10 text-center">
                        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                            <Store className="h-7 w-7" />
                        </span>
                        <h2 className="mb-2 text-xl font-bold">No contact details yet</h2>
                        <p className="mb-6 text-muted-foreground">
                            {name} hasn't published a phone number or address. You can still build an order and
                            send it from the cart.
                        </p>
                        <Button variant="outline" className="h-11" asChild>
                            <Link to={`/store/${slug}/products`}>Browse products</Link>
                        </Button>
                    </div>
                ) : (
                    <div className={`grid gap-6 ${mapsUrl || hasUpiInfo ? "lg:grid-cols-2" : "mx-auto max-w-xl"}`}>
                        {/* Contact Cards */}
                        <div className="min-w-0 space-y-4">
                            <h2 className="mb-4 text-xl font-bold">Contact information</h2>

                            {/* Main WhatsApp / Phone */}
                            {(mainPhone || email || gstNumber) && (
                                <Card>
                                    <CardContent className="p-5">
                                        {mainPhone && (
                                            <div className="mb-3 flex items-center gap-3">
                                                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                                                    <Phone className="h-5 w-5 text-primary" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-semibold">Main contact</p>
                                                    <a
                                                        href={`tel:${phoneDigits(mainPhone)}`}
                                                        className="break-anywhere text-sm text-primary hover:underline"
                                                    >
                                                        {mainPhone}
                                                    </a>
                                                </div>
                                            </div>
                                        )}
                                        {email && (
                                            <p className="flex items-start gap-2 text-sm text-muted-foreground">
                                                <Mail className="mt-0.5 h-4 w-4 flex-shrink-0" />
                                                <a href={`mailto:${email}`} className="break-anywhere hover:text-foreground">
                                                    {email}
                                                </a>
                                            </p>
                                        )}
                                        {gstNumber && (
                                            <p className="mt-1 break-anywhere text-sm text-muted-foreground">
                                                GST: {gstNumber}
                                            </p>
                                        )}
                                    </CardContent>
                                </Card>
                            )}

                            {/* Contact 1 */}
                            {(contactName1 || contactPhone1) && (
                                <Card>
                                    <CardContent className="p-5">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-muted">
                                                <User className="h-5 w-5 text-muted-foreground" />
                                            </div>
                                            <div className="min-w-0">
                                                {contactName1 && <p className="break-anywhere font-semibold">{contactName1}</p>}
                                                {contactPhone1 && (
                                                    <a
                                                        href={`tel:${phoneDigits(contactPhone1)}`}
                                                        className="break-anywhere text-sm text-primary hover:underline"
                                                    >
                                                        {contactPhone1}
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {/* Contact 2 */}
                            {(contactName2 || contactPhone2) && (
                                <Card>
                                    <CardContent className="p-5">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-muted">
                                                <User className="h-5 w-5 text-muted-foreground" />
                                            </div>
                                            <div className="min-w-0">
                                                {contactName2 && <p className="break-anywhere font-semibold">{contactName2}</p>}
                                                {contactPhone2 && (
                                                    <a
                                                        href={`tel:${phoneDigits(contactPhone2)}`}
                                                        className="break-anywhere text-sm text-primary hover:underline"
                                                    >
                                                        {contactPhone2}
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {!hasExtraContacts && (
                                <p className="text-sm text-muted-foreground">
                                    No additional contact people have been listed.
                                </p>
                            )}
                        </div>

                        {/* Google Map */}
                        {mapsUrl && (
                            <div className="min-w-0 space-y-4">
                                <h2 className="mb-4 text-xl font-bold">Our location</h2>
                                <Card className="group overflow-hidden transition-colors hover:border-primary/50">
                                    <CardContent className="p-6 text-center sm:p-8">
                                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 transition-transform group-hover:scale-110">
                                            <MapPin className="h-8 w-8 text-primary" />
                                        </div>
                                        <h3 className="mb-2 text-lg font-semibold">Find us on the map</h3>
                                        <p className="mb-4 text-sm text-muted-foreground">
                                            Opens Google Maps with this store's location.
                                        </p>
                                        <Button className="h-11 gap-2" asChild>
                                            <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
                                                <MapPin className="h-4 w-4" />
                                                Open in Google Maps
                                            </a>
                                        </Button>
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {/* UPI Payment Info */}
                        {hasUpiInfo && (
                            <div className="min-w-0 space-y-4">
                                <h2 className="mb-4 text-xl font-bold">Payment info</h2>
                                <Card className="overflow-hidden transition-colors hover:border-primary/50">
                                    <CardContent className="p-5 sm:p-6">
                                        <div className="mb-4 flex items-center gap-3">
                                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                                                <CreditCard className="h-5 w-5 text-primary" />
                                            </div>
                                            <p className="font-semibold">UPI payment</p>
                                        </div>
                                        {upiId && (
                                            <div className="mb-4">
                                                <p className="mb-1 text-sm text-muted-foreground">UPI ID</p>
                                                <p className="select-all break-anywhere rounded-md bg-muted px-3 py-2 font-medium text-foreground">
                                                    {upiId}
                                                </p>
                                            </div>
                                        )}
                                        {upiQrUrl && (
                                            <div className="flex flex-col items-center">
                                                <p className="mb-2 text-sm text-muted-foreground">Scan to pay</p>
                                                {/* The white plate is functional, not styling: UPI apps fail to
                                                    read a QR rendered on a dark background. */}
                                                <img
                                                    src={upiQrUrl}
                                                    alt={`UPI QR code for ${name}`}
                                                    className="h-44 w-44 max-w-full rounded-lg border bg-white object-contain p-2 sm:h-48 sm:w-48"
                                                />
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Footer */}
            <footer className="mt-8 border-t bg-card">
                <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                    <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
                        <div className="flex min-w-0 items-center gap-3">
                            <StoreLogo url={company.logo_url} name={name} className="h-10" fallbackClassName="h-5 w-5" />
                            <p className="break-anywhere font-bold">{name}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Powered by{" "}
                            <Link to="/" className="text-primary hover:underline">
                                CatalogShare
                            </Link>
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default StoreAbout;
