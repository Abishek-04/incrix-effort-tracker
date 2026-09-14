import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Providers } from "@/components/Providers";
import { getSession } from "@/server/auth";

// Every signed-in page renders inside this layout. The session is verified on the server,
// including revocation (e.g. after a password change), before any app UI is sent.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login?expired=1");
  return <Providers user={{ role: session.role, email: session.email }}>{children}</Providers>;
}
