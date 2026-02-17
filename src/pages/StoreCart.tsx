import { useParams, Link } from "react-router-dom";
import { useCompanyBySlug } from "@/hooks/useCompany";
import { useCart, getCartKey } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Minus, Send, ShoppingCart, Store } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

const StoreCart = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: company, isLoading: companyLoading } = useCompanyBySlug(slug || "");
  const { items, removeFromCart, updateQuantity, clearCart, totalItems } = useCart();
  const [customerName, setCustomerName] = useState("");

  if (companyLoading) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  }

  if (!company) {
    return <div className="min-h-screen flex items-center justify-center"><p>Store not found.</p></div>;
  }

  const sendToWhatsApp = () => {
    if (items.length === 0) { toast.error("Your cart is empty!"); return; }
    if (!customerName.trim()) { toast.error("Please enter your name or company name."); return; }

    let message = `🛒 *Order to ${company.name}*\n`;
    message += `👤 *From: ${customerName.trim()}*\n\n`;
    items.forEach((item, idx) => {
      message += `${idx + 1}. *${item.product.name}*\n`;
      if (item.selectedSize) message += `   Size: ${item.selectedSize}\n`;
      if (item.selectedFeature) message += `   Option: ${item.selectedFeature}\n`;
      message += `   Qty: ${item.quantity}\n\n`;
    });
    message += `Please confirm this order. Thank you!`;

    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${company.phone}?text=${encoded}`, "_blank");
    toast.success("Opening WhatsApp...");
  };

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
            <div className="flex items-center gap-4">
              <Link to={`/store/${slug}/products`} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Products</Link>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {items.length === 0 ? (
          <div className="text-center py-20">
            <ShoppingCart className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-30" />
            <h1 className="text-2xl font-bold mb-2">Your cart is empty</h1>
            <p className="text-muted-foreground mb-6">Browse products and add items to your cart.</p>
            <Button asChild><Link to={`/store/${slug}/products`}>Browse Products</Link></Button>
          </div>
        ) : (
          <>
            <h1 className="text-3xl font-bold mb-6">Your Cart</h1>
            <div className="space-y-3">
              {items.map((item) => {
                const key = getCartKey(item.product.id, item.selectedSize, item.selectedFeature);
                return (
                  <Card key={key}>
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                        {item.product.image_url ? (
                          <img src={item.product.image_url} alt={item.product.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center"><ShoppingCart className="h-6 w-6 opacity-20" /></div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm truncate">{item.product.name}</h3>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.selectedSize && <Badge variant="secondary" className="text-xs">{item.selectedSize}</Badge>}
                          {item.selectedFeature && <Badge variant="outline" className="text-xs">{item.selectedFeature}</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQuantity(key, item.quantity - 1)}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center font-medium text-sm">{item.quantity}</span>
                        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQuantity(key, item.quantity + 1)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeFromCart(key)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card className="mt-6">
              <CardContent className="p-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="customerName">Your Name / Company Name *</Label>
                  <Input id="customerName" placeholder="Enter your name or company name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={100} />
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={clearCart} className="flex-1">Clear Cart</Button>
                  <Button onClick={sendToWhatsApp} className="flex-1 bg-green-600 hover:bg-green-700">
                    <Send className="h-4 w-4 mr-2" /> Send on WhatsApp
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

export default StoreCart;
