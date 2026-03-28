"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { Menu, X } from "lucide-react";
import type { NavGroup } from "./layout";

interface AdminSidebarProps {
  groups: NavGroup[];
  userName: string;
  roleBadge: { label: string; cls: string };
}

export function AdminSidebar({ groups, userName, roleBadge }: AdminSidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  };

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo — desktop only */}
      <div className="hidden lg:flex items-center gap-3 px-5 py-4 border-b border-zinc-800">
        <Link href="/admin" onClick={() => setMobileOpen(false)}>
          <Image
            src="/blackLogo.png"
            alt="Momentum Arena"
            width={180}
            height={60}
            className="h-16 w-auto"
          />
        </Link>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200 border border-transparent"
                      }`}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-emerald-400" : "text-zinc-500"}`} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t border-zinc-800 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-300 truncate">{userName}</p>
            <span className={`inline-block mt-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium border ${roleBadge.cls}`}>
              {roleBadge.label}
            </span>
          </div>
          <SignOutButton isAdmin redirectTo="/godmode" />
        </div>
        <Link
          href="/admin/profile"
          onClick={() => setMobileOpen(false)}
          className="block text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Edit profile
        </Link>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-zinc-950 border-r border-zinc-800 transform transition-transform duration-200 ease-in-out lg:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <Link href="/admin" onClick={() => setMobileOpen(false)}>
            <Image
              src="/blackLogo.png"
              alt="Momentum Arena"
              width={140}
              height={47}
              className="h-12 w-auto"
            />
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="h-[calc(100vh-57px)] overflow-hidden">
          {sidebarContent}
        </div>
      </aside>

      {/* Desktop sidebar — always visible */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex lg:w-64 lg:flex-col bg-zinc-950 border-r border-zinc-800">
        {sidebarContent}
      </aside>
    </>
  );
}
