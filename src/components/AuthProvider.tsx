"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { Role } from "@/lib/session";

export type User = { role: Role; email: string };
type AuthCtx = { user: User; isAdmin: boolean; signOut: () => Promise<void> };

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ user, children }: { user: User; children: ReactNode }) {
  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }, []);
  return <Ctx.Provider value={{ user, isAdmin: user.role === "admin", signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
