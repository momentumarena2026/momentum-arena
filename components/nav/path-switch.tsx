"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Renders `match` on routes under `prefix`, `otherwise` everywhere
 * else. Lets a SERVER layout swap chrome per sub-route (e.g. the full
 * SiteHeader everywhere in /book except the checkout payment screen)
 * without turning the whole layout client-side — both subtrees arrive
 * server-rendered as children.
 */
export function PathSwitch({
  prefix,
  match,
  otherwise,
}: {
  prefix: string;
  match: ReactNode;
  otherwise: ReactNode;
}) {
  const pathname = usePathname();
  return <>{pathname?.startsWith(prefix) ? match : otherwise}</>;
}
