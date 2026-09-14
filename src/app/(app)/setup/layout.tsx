import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession } from "@/server/auth";

export const metadata = { title: "Setup · Incrix Effort Tracker" };

export default async function SetupLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session?.role !== "admin") redirect("/dashboard");
  return children;
}
