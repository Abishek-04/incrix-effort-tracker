"use client";

import type { ReactNode } from "react";
import { AppShell } from "./AppShell";
import { AuthProvider, type User } from "./AuthProvider";
import { DataProvider } from "./DataProvider";
import { UIProvider } from "./UIProvider";

export function Providers({ user, children }: { user: User; children: ReactNode }) {
  return (
    <UIProvider>
      <AuthProvider user={user}>
        <DataProvider>
          <AppShell>{children}</AppShell>
        </DataProvider>
      </AuthProvider>
    </UIProvider>
  );
}
