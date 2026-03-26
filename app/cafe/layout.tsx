import { CafeCartProvider } from "@/lib/cafe-cart-context";

export default function CafeLayout({ children }: { children: React.ReactNode }) {
  return <CafeCartProvider>{children}</CafeCartProvider>;
}
