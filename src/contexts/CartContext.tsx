import React, { createContext, useContext, useState, ReactNode } from "react";
import { Tables } from "@/integrations/supabase/types";

type Product = Tables<"products">;

export interface CartItem {
  product: Product;
  quantity: number;
  selectedSize: string | null;
  selectedFeature: string | null;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (product: Product, quantity: number, selectedSize: string | null, selectedFeature: string | null) => void;
  removeFromCart: (cartKey: string) => void;
  updateQuantity: (cartKey: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
}

// Unique key per product+size+feature combo
const getCartKey = (productId: string, size: string | null, feature: string | null) =>
  `${productId}__${size || ""}__${feature || ""}`;

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<CartItem[]>([]);

  const addToCart = (product: Product, quantity: number, selectedSize: string | null, selectedFeature: string | null) => {
    const key = getCartKey(product.id, selectedSize, selectedFeature);
    setItems((prev) => {
      const existing = prev.find(
        (i) => getCartKey(i.product.id, i.selectedSize, i.selectedFeature) === key
      );
      if (existing) {
        return prev.map((i) =>
          getCartKey(i.product.id, i.selectedSize, i.selectedFeature) === key
            ? { ...i, quantity: i.quantity + quantity }
            : i
        );
      }
      return [...prev, { product, quantity, selectedSize, selectedFeature }];
    });
  };

  const removeFromCart = (cartKey: string) => {
    setItems((prev) =>
      prev.filter((i) => getCartKey(i.product.id, i.selectedSize, i.selectedFeature) !== cartKey)
    );
  };

  const updateQuantity = (cartKey: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(cartKey);
      return;
    }
    setItems((prev) =>
      prev.map((i) =>
        getCartKey(i.product.id, i.selectedSize, i.selectedFeature) === cartKey
          ? { ...i, quantity }
          : i
      )
    );
  };

  const clearCart = () => setItems([]);

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider
      value={{ items, addToCart, removeFromCart, updateQuantity, clearCart, totalItems }}
    >
      {children}
    </CartContext.Provider>
  );
};

export { getCartKey };

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider");
  return context;
};
