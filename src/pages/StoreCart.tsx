import { useParams, Link } from "react-router-dom";
import { useCompanyBySlug } from "@/hooks/useCompany";
import { useCart, getCartKey } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import StoreLogo from "@/components/StoreLogo";
import ThemeToggle from "@/components/ThemeToggle";
import { Trash2, Plus, Minus, Send, ShoppingCart, Store, StickyNote, Menu, X, ImageOff } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import useStoreTheme from "@/hooks/useStoreTheme";
import { supabase } from "@/integrations/supabase/client";
import { openWhatsApp } from "@/native/files";
import { productName, asText } from "@/lib/productData";
import { phoneDigits, storeName } from "@/lib/storefront";

const StoreCart = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: company, isLoading: companyLoading } = useCompanyBySlug(slug || "");
  // Bound to this store explicitly so the order can never carry another store's items.
  const { items, removeFromCart, updateQuantity, clearCart } = useCart(slug);
  const [customerName, setCustomerName] = useState("");
  const [customNote, setCustomNote] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Apply company color theme
  useStoreTheme(company?.theme_primary || null, company?.theme_accent || null);

  if (companyLoading) {
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
          <p className="mb-6 text-muted-foreground">
            This catalog doesn't exist or has been removed, so there is nowhere to send this order.
          </p>
          <Button asChild className="h-11">
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </div>
    );
  }

  const name = storeName(company);
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);

  const sendToWhatsApp = async () => {
    if (items.length === 0) {
      toast.error("Your cart is empty.");
      return;
    }
    if (!customerName.trim()) {
      setNameError("Add your name so the store knows who the order is from.");
      return;
    }
    setNameError(null);

    // productName() covers rows saved before `name` was NOT NULL — without it
    // the message read "1. *null*" and the merchant could not fill the order.
    let message = `• *Order to ${name}*\n`;
    message += `• *From: ${customerName.trim()}*\n\n`;
    items.forEach((item, idx) => {
      message += `${idx + 1}. *${productName(item.product)}*\n`;
      if (item.selectedSize) message += `   Size: ${item.selectedSize}\n`;
      if (item.selectedFeature) message += `   Option: ${item.selectedFeature}\n`;
      message += `   Qty: ${item.quantity}\n\n`;
    });
    if (customNote.trim()) {
      message += `📝 *Special Note:*\n${customNote.trim()}\n\n`;
    }
    message += `Please confirm this order.\n\nThank you, visit again!\n${window.location.origin}/store/${slug}`;

    // Strip anything that isn't a digit (like '+', ' ', '-') from the phone number
    const formattedPhone = phoneDigits(company.phone);

    // wa.me accepts an empty recipient and opens a blank chat, so a store with
    // no number used to look like a sent order that nobody ever received.
    if (formattedPhone.length < 10) {
      toast.error("This store hasn't added a WhatsApp number yet. Try the About page for other contacts.");
      return;
    }

    setSending(true);

    // Track WhatsApp click event — fire and forget: an offline device must not
    // raise an unhandled rejection, and analytics never blocks the order.
    void Promise.resolve(
      supabase.from("analytics_events").insert({
        event_type: "whatsapp_click",
        page_url: `/store/${slug}/cart`,
        company_id: company.id,
      })
    ).catch((err) => console.warn("Failed to track whatsapp click", err));

    // Handed to the native helper rather than window.open: mobile browsers block
    // a popup opened after an async hop and an Android WebView swallows it
    // outright, so the customer tapped Send and nothing happened.
    try {
      await openWhatsApp(formattedPhone, message);
      toast.success("Opening WhatsApp...");
    } catch {
      toast.error("Couldn't open WhatsApp. Make sure it's installed, then try again.");
    } finally {
      setSending(false);
    }
  };

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
                to={`/store/${slug}/products`}
                className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
              >
                Products
              </Link>
              <Link
                to={`/store/${slug}/about`}
                className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
              >
                About
              </Link>
              <ThemeToggle />
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

      <div className="mx-auto max-w-3xl px-4 py-8">
        {items.length === 0 ? (
          <div className="mx-auto max-w-md py-20 text-center">
            <ShoppingCart className="mx-auto mb-4 h-16 w-16 text-muted-foreground opacity-30" />
            <h1 className="mb-2 text-2xl font-bold">Your cart is empty</h1>
            <p className="mb-6 text-muted-foreground">
              Add the items you need from the catalog and send them to {name} in one WhatsApp message.
            </p>
            <Button asChild className="h-11">
              <Link to={`/store/${slug}/products`}>Browse products</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold sm:text-3xl">Your cart</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {items.length} {items.length === 1 ? "item" : "items"} · {totalUnits}{" "}
                {totalUnits === 1 ? "unit" : "units"} total
              </p>
            </div>

            <div className="space-y-3">
              {items.map((item) => {
                const key = getCartKey(item.product.id, item.selectedSize, item.selectedFeature);
                const label = productName(item.product);
                const image = asText(item.product.image_url).trim();
                return (
                  <Card key={key}>
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex items-start gap-3">
                        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                          {image ? (
                            <img src={image} alt={label} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                              <ImageOff className="h-6 w-6" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="break-anywhere text-sm font-semibold leading-snug">{label}</h3>
                          {(item.selectedSize || item.selectedFeature) && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {item.selectedSize && (
                                <Badge variant="secondary" className="max-w-full break-anywhere text-xs">
                                  {item.selectedSize}
                                </Badge>
                              )}
                              {item.selectedFeature && (
                                <Badge variant="outline" className="max-w-full break-anywhere text-xs">
                                  {item.selectedFeature}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${label} from cart`}
                          className="h-11 w-11 flex-shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => removeFromCart(key)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Quantity gets its own row: on a 360px screen the image,
                          the name and three controls on one line forced the
                          whole page to scroll sideways. */}
                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="outline"
                          aria-label={`Decrease quantity of ${label}`}
                          // Removal is the trash button's job — stepping to zero
                          // deleted the row under the customer's thumb.
                          disabled={item.quantity <= 1}
                          className="h-11 w-11"
                          onClick={() => updateQuantity(key, item.quantity - 1)}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span
                          aria-live="polite"
                          className="min-w-11 text-center text-sm font-semibold tabular-nums"
                        >
                          {item.quantity}
                        </span>
                        <Button
                          size="icon"
                          variant="outline"
                          aria-label={`Increase quantity of ${label}`}
                          className="h-11 w-11"
                          onClick={() => updateQuantity(key, item.quantity + 1)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card className="mt-6">
              <CardContent className="space-y-4 p-4 sm:p-6">
                <div className="space-y-2">
                  <Label htmlFor="customerName">Your name / company name *</Label>
                  <Input
                    id="customerName"
                    placeholder="Enter your name or company name"
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                      if (nameError) setNameError(null);
                    }}
                    maxLength={100}
                    aria-invalid={!!nameError}
                    aria-describedby={nameError ? "customerName-error" : undefined}
                    className="h-11"
                  />
                  {nameError && (
                    <p id="customerName-error" className="text-sm font-medium text-destructive">
                      {nameError}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="customNote" className="flex items-center gap-2">
                    <StickyNote className="h-4 w-4 text-primary" />
                    Special instructions / custom note
                  </Label>
                  <Textarea
                    id="customNote"
                    placeholder="E.g., Need 100 pieces, deliver by next week, specific packaging requests..."
                    value={customNote}
                    onChange={(e) => setCustomNote(e.target.value)}
                    maxLength={500}
                    rows={3}
                    className="resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    This note will be included in your WhatsApp order message.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    variant="outline"
                    onClick={() => setConfirmClear(true)}
                    disabled={sending}
                    className="h-12 flex-1"
                  >
                    Clear cart
                  </Button>
                  <Button
                    onClick={() => void sendToWhatsApp()}
                    disabled={sending}
                    // The brand green is deliberate; text-white keeps the label
                    // readable, since primary-foreground flips with the theme.
                    className="h-12 flex-1 bg-green-600 text-white hover:bg-green-700"
                  >
                    <Send className="mr-2 h-4 w-4" />
                    {sending ? "Opening WhatsApp..." : "Send on WhatsApp"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Clearing was a single unconfirmed tap next to Send, and the basket is
          the customer's only record of what they picked. */}
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent className="max-h-[85dvh] w-[calc(100vw-2rem)] overflow-y-auto sm:w-[425px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear your cart?</AlertDialogTitle>
            <AlertDialogDescription>
              All {items.length} {items.length === 1 ? "item" : "items"} will be removed. You'll have to
              pick them again from the catalog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Keep them</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                clearCart();
                toast.success("Cart cleared.");
              }}
            >
              Clear cart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default StoreCart;
