import { Link } from "react-router-dom";
import { ShoppingCart, Menu, X } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import logo from "@/assets/logo_sve.png";

const Navbar = () => {
  const { totalItems } = useCart();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="Sri Vijayalaxmi Enterprise" className="h-10 w-auto" />
            <span className="font-bold text-lg hidden sm:block">Sri Vijayalaxmi Enterprise</span>
          </Link>

          <div className="hidden md:flex items-center gap-6">
            <Link to="/" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Home</Link>
            <Link to="/products" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Products</Link>
            <Link to="/about" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">About</Link>
            <Link to="/cart" className="relative">
              <Button variant="outline" size="icon">
                <ShoppingCart className="h-5 w-5" />
              </Button>
              {totalItems > 0 && (
                <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                  {totalItems}
                </span>
              )}
            </Link>
          </div>

          <div className="md:hidden flex items-center gap-2">
            <Link to="/cart" className="relative">
              <Button variant="outline" size="icon">
                <ShoppingCart className="h-5 w-5" />
              </Button>
              {totalItems > 0 && (
                <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                  {totalItems}
                </span>
              )}
            </Link>
            <Button variant="ghost" size="icon" onClick={() => setMobileOpen(!mobileOpen)}>
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t bg-card p-4 space-y-2">
          <Link to="/" onClick={() => setMobileOpen(false)} className="block py-2 text-sm font-medium">Home</Link>
          <Link to="/products" onClick={() => setMobileOpen(false)} className="block py-2 text-sm font-medium">Products</Link>
          <Link to="/about" onClick={() => setMobileOpen(false)} className="block py-2 text-sm font-medium">About</Link>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
