"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { trackCafeItemAdded, trackCafeItemRemoved } from "@/lib/analytics";

export interface CafeCartItem {
  itemId: string;
  name: string;
  price: number; // paise
  quantity: number;
  image?: string;
  isVeg: boolean;
  category: string;
}

interface CafeCartContextType {
  items: CafeCartItem[];
  addItem: (item: Omit<CafeCartItem, "quantity">) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
  totalAmount: number; // paise
}

const CafeCartContext = createContext<CafeCartContextType | null>(null);

const STORAGE_KEY = "cafe-cart";
const MAX_TOTAL_QUANTITY = 50;

function loadCart(): CafeCartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function saveCart(items: CafeCartItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

export function CafeCartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CafeCartItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setItems(loadCart());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) {
      saveCart(items);
    }
  }, [items, loaded]);

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalAmount = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const addItem = useCallback(
    (item: Omit<CafeCartItem, "quantity">) => {
      trackCafeItemAdded(item.name, item.price);
      setItems((prev) => {
        const existing = prev.find((i) => i.itemId === item.itemId);
        const currentTotal = prev.reduce((sum, i) => sum + i.quantity, 0);

        if (currentTotal >= MAX_TOTAL_QUANTITY) return prev;

        if (existing) {
          return prev.map((i) =>
            i.itemId === item.itemId ? { ...i, quantity: i.quantity + 1 } : i
          );
        }
        return [...prev, { ...item, quantity: 1 }];
      });
    },
    []
  );

  const removeItem = useCallback((itemId: string) => {
    setItems((prev) => {
      const item = prev.find((i) => i.itemId === itemId);
      if (item) trackCafeItemRemoved(item.name);
      return prev.filter((i) => i.itemId !== itemId);
    });
  }, []);

  const updateQuantity = useCallback((itemId: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) => prev.filter((i) => i.itemId !== itemId));
      return;
    }
    setItems((prev) => {
      const currentTotal = prev.reduce((sum, i) => sum + i.quantity, 0);
      const existing = prev.find((i) => i.itemId === itemId);
      if (!existing) return prev;

      const diff = quantity - existing.quantity;
      if (diff > 0 && currentTotal + diff > MAX_TOTAL_QUANTITY) return prev;

      return prev.map((i) =>
        i.itemId === itemId ? { ...i, quantity } : i
      );
    });
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  return (
    <CafeCartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        totalItems,
        totalAmount,
      }}
    >
      {children}
    </CafeCartContext.Provider>
  );
}

export function useCafeCart() {
  const context = useContext(CafeCartContext);
  if (!context) {
    throw new Error("useCafeCart must be used within a CafeCartProvider");
  }
  return context;
}
