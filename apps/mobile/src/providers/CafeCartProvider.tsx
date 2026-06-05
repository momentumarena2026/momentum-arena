import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { MMKV } from "react-native-mmkv";

/**
 * Local-only cart for the customer cafe flow. Mirrors the web's
 * `useCafeCart` context — entirely client-side, no server-side cart
 * row (the cafe doesn't need cross-device persistence like the shop
 * does). MMKV-persisted so the user can background the app, come
 * back, and resume.
 *
 * The cart is a flat list of `{cafeItemId, quantity, name, price}`
 * snapshots. Stale prices / out-of-stock are surfaced at checkout
 * time by the server-side stock and price validation, not here —
 * the cart only knows what the user picked.
 */

const storage = new MMKV({ id: "ma-cafe-cart" });
const STORAGE_KEY = "v1";

export interface CafeCartLine {
  cafeItemId: string;
  name: string;
  price: number; // rupees — snapshot at add-to-cart time
  quantity: number;
  isVeg: boolean;
  imageUrl?: string | null;
  /** Drives the Ready/Kitchen routing — null on the original
   *  CafeItem means "kitchen-prepared / unlimited"; integer means
   *  "stock-tracked / counter-handover". */
  trackedStock: number | null;
}

interface State {
  lines: CafeCartLine[];
}

interface CafeCartContextValue {
  lines: CafeCartLine[];
  itemCount: number;
  subtotal: number;
  addItem: (line: Omit<CafeCartLine, "quantity"> & { quantity?: number }) => void;
  setQuantity: (cafeItemId: string, quantity: number) => void;
  increment: (cafeItemId: string) => void;
  decrement: (cafeItemId: string) => void;
  clear: () => void;
  getQuantity: (cafeItemId: string) => number;
}

const CafeCartContext = createContext<CafeCartContextValue | null>(null);

function loadInitial(): State {
  try {
    const raw = storage.getString(STORAGE_KEY);
    if (!raw) return { lines: [] };
    const parsed = JSON.parse(raw) as State;
    if (!Array.isArray(parsed.lines)) return { lines: [] };
    return parsed;
  } catch {
    return { lines: [] };
  }
}

export function CafeCartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => loadInitial());

  useEffect(() => {
    try {
      storage.set(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Best-effort persistence; cart is rebuildable.
    }
  }, [state]);

  const addItem = useCallback(
    (line: Omit<CafeCartLine, "quantity"> & { quantity?: number }) => {
      setState((prev) => {
        const existing = prev.lines.find((l) => l.cafeItemId === line.cafeItemId);
        const delta = line.quantity ?? 1;
        if (existing) {
          return {
            lines: prev.lines.map((l) =>
              l.cafeItemId === line.cafeItemId
                ? { ...l, quantity: l.quantity + delta }
                : l,
            ),
          };
        }
        const { quantity: _q, ...rest } = line;
        void _q;
        return {
          lines: [
            ...prev.lines,
            { ...rest, quantity: delta },
          ],
        };
      });
    },
    [],
  );

  const setQuantity = useCallback((cafeItemId: string, quantity: number) => {
    setState((prev) => {
      if (quantity <= 0) {
        return {
          lines: prev.lines.filter((l) => l.cafeItemId !== cafeItemId),
        };
      }
      return {
        lines: prev.lines.map((l) =>
          l.cafeItemId === cafeItemId ? { ...l, quantity } : l,
        ),
      };
    });
  }, []);

  const increment = useCallback(
    (cafeItemId: string) => {
      setState((prev) => ({
        lines: prev.lines.map((l) =>
          l.cafeItemId === cafeItemId ? { ...l, quantity: l.quantity + 1 } : l,
        ),
      }));
    },
    [],
  );

  const decrement = useCallback(
    (cafeItemId: string) => {
      setState((prev) => {
        const existing = prev.lines.find((l) => l.cafeItemId === cafeItemId);
        if (!existing) return prev;
        if (existing.quantity <= 1) {
          return { lines: prev.lines.filter((l) => l.cafeItemId !== cafeItemId) };
        }
        return {
          lines: prev.lines.map((l) =>
            l.cafeItemId === cafeItemId
              ? { ...l, quantity: l.quantity - 1 }
              : l,
          ),
        };
      });
    },
    [],
  );

  const clear = useCallback(() => setState({ lines: [] }), []);

  const getQuantity = useCallback(
    (cafeItemId: string) =>
      state.lines.find((l) => l.cafeItemId === cafeItemId)?.quantity ?? 0,
    [state.lines],
  );

  const value = useMemo<CafeCartContextValue>(() => {
    const itemCount = state.lines.reduce((s, l) => s + l.quantity, 0);
    const subtotal = state.lines.reduce(
      (s, l) => s + l.price * l.quantity,
      0,
    );
    return {
      lines: state.lines,
      itemCount,
      subtotal,
      addItem,
      setQuantity,
      increment,
      decrement,
      clear,
      getQuantity,
    };
  }, [
    state.lines,
    addItem,
    setQuantity,
    increment,
    decrement,
    clear,
    getQuantity,
  ]);

  return (
    <CafeCartContext.Provider value={value}>
      {children}
    </CafeCartContext.Provider>
  );
}

export function useCafeCart(): CafeCartContextValue {
  const ctx = useContext(CafeCartContext);
  if (!ctx) {
    throw new Error("useCafeCart must be used inside <CafeCartProvider />");
  }
  return ctx;
}
