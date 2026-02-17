import { useCart, getCartKey } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Minus, Send, ShoppingCart } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useState } from "react";

const WHATSAPP_NUMBER = "918431123556";

const Cart = () => {
  const { items, removeFromCart, updateQuantity, clearCart } = useCart();
  const [customerName, setCustomerName] = useState("");

  const sendToWhatsApp = () => {
    if (items.length === 0) {
      toast.error("Your cart is empty!");
      return;
    }
    if (!customerName.trim()) {
      toast.error("Please enter your name or company name.");
      return;
    }

    let message = `🛒 *Order to Sri Vijayalaxmi Enterprise*\n`;
    message += `👤 *From: ${customerName.trim()}*\n\n`;
    items.forEach((item, idx) => {
      message += `${idx + 1}. *${item.product.name}*\n`;
      if (item.selectedSize) message += `   Size: ${item.selectedSize}\n`;
      if (item.selectedFeature) message += `   Option: ${item.selectedFeature}\n`;
      message += `   Qty: ${item.quantity}\n\n`;
    });
    message += `Please confirm this order. Thank you!`;

    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encoded}`, "_blank");
    toast.success("Opening WhatsApp...");
  };

  if (items.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <ShoppingCart className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-30" />
        <h1 className="text-2xl font-bold mb-2">Your cart is empty</h1>
        <p className="text-muted-foreground mb-6">Browse our products and add items to your cart.</p>
        <Button asChild>
          <Link to="/products">Browse Products</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
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
                    <div className="w-full h-full flex items-center justify-center">
                      <ShoppingCart className="h-6 w-6 opacity-20" />
                    </div>
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
            <Input
              id="customerName"
              placeholder="Enter your name or company name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={clearCart} className="flex-1">
              Clear Cart
            </Button>
            <Button onClick={sendToWhatsApp} className="flex-1 bg-green-600 hover:bg-green-700">
              <Send className="h-4 w-4 mr-2" />
              Send on WhatsApp
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Cart;
