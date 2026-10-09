"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { initials } from "@/lib/utils";
import { useAuth } from "./AuthProvider";
import { useData } from "./DataProvider";
import { Icon, type IconName } from "./Icon";

type NavItem = { href: string; label: string; icon: IconName };
const WORKSPACE: NavItem[] = [
  { href: "/log", label: "Log work", icon: "log" },
  { href: "/dashboard", label: "Dashboard", icon: "dash" },
  { href: "/grid", label: "Daily grid", icon: "grid" },
  { href: "/entries", label: "Entries", icon: "entries" },
  { href: "/jobs", label: "Job cards", icon: "layers" },
];
/** A personal login sees its own work and its own progress — not the team person by person. */
const MEMBER_WORKSPACE: NavItem[] = [
  { href: "/log", label: "Log work", icon: "log" },
  { href: "/dashboard", label: "My progress", icon: "dash" },
  { href: "/entries", label: "My entries", icon: "entries" },
  { href: "/jobs", label: "Job cards", icon: "layers" },
  { href: "/my-insights", label: "My insights", icon: "spark" },
];
/** The shared login could be anyone, so it logs work and sees totals — never a person's figures. */
const SHARED_WORKSPACE: NavItem[] = [
  { href: "/log", label: "Log work", icon: "log" },
  { href: "/dashboard", label: "Studio progress", icon: "dash" },
  { href: "/jobs", label: "Job cards", icon: "layers" },
];
const ADMIN: NavItem[] = [
  { href: "/insights", label: "Insights", icon: "spark" },
  { href: "/setup", label: "Setup", icon: "setup" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, error, reload, pending, months, viewMonth, team } = useData();
  const { user, isAdmin, isMember, signOut } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  const workspace = isMember ? MEMBER_WORKSPACE : isAdmin ? WORKSPACE : SHARED_WORKSPACE;
  // Every page, so the breadcrumb and tab title still name a page the current role can't navigate to.
  const current = [...workspace, ...WORKSPACE, ...MEMBER_WORKSPACE, ...ADMIN].find((n) => pathname.startsWith(n.href));

  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => { document.title = `${current?.label ?? "Home"} · Incrix Effort Tracker`; }, [current]);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(t === "dark" || t === "light" ? t : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("incrix-theme", next); } catch {}
    setTheme(next);
  };

  const memberName = isMember ? team.find((m) => m.id === user.memberId)?.name : undefined;
  const count = months[viewMonth]?.status === "ready" ? months[viewMonth].entries.length : null;
  const navLink = (n: NavItem) => {
    const on = pathname.startsWith(n.href);
    return (
      <Link key={n.href} href={n.href} className={`navbtn${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
        <Icon name={n.icon} />
        <span>{n.label}</span>
        {n.href === "/entries" && count !== null && <span className="count">{count}</span>}
      </Link>
    );
  };

  return (
    <div className={`app${navOpen ? " navopen" : ""}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand"><div className="logo">IX</div><div><b>Incrix</b><small>Effort Tracker</small></div></div>
        <div className="navlabel">Workspace</div>
        <nav style={{ display: "grid", gap: 2 }}>
          {workspace.map(navLink)}
          {isAdmin && (
            <>
              <div className="navlabel">Administration</div>
              {ADMIN.map(navLink)}
            </>
          )}
        </nav>
        <div className="spacer" />
        <div className="storebox">
          <span className={`dot${status === "error" ? " warn" : ""}`} />
          <div>
            <b>{status === "error" ? "Database unreachable" : "AWS DynamoDB"}</b>
            {status === "error" ? "Changes can't be saved" : "Shared across your team"}
          </div>
        </div>
        <div className="userbox">
          <span className="av sm" aria-hidden="true">{isAdmin ? "AD" : isMember ? initials(memberName ?? user.email) : "TM"}</span>
          <div className="meta2">
            <b title={user.email}>{isMember ? (memberName ?? user.email) : user.email}</b>
            <span className="rolepill">{isAdmin ? "Administrator" : isMember ? "Personal login" : "Team"}</span>
          </div>
          <button className="iconbtn" onClick={signOut} aria-label="Sign out" data-tip="Sign out"><Icon name="logout" size={16} /></button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <div className="shell">
        <header className="topbar">
          <button className="iconbtn menubtn" aria-label="Open menu" onClick={() => setNavOpen((o) => !o)}><Icon name="menu" /></button>
          <div className="crumbs"><span className="hide-sm">Incrix</span><span className="hide-sm" aria-hidden="true">/</span><b>{current?.label}</b></div>
          <div className="spacer" />
          <div className={`savestate${pending ? " saving" : ""}`}>
            <Icon name={pending ? "refresh" : "checkc"} size={14} />
            <span>{pending ? "Saving…" : "All changes saved"}</span>
          </div>
          <button className="iconbtn" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} data-tip={theme === "dark" ? "Light mode" : "Dark mode"}>
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
          {!pathname.startsWith("/log") && (
            <Link className="btn sm" href="/log"><Icon name="plus" size={14} />Log work</Link>
          )}
        </header>
        <main id="main">
          {status === "error" ? (
            <div className="errorbox" role="alert">
              <Icon name="alert" />
              <div><b>Couldn&apos;t load the tracker</b>{error}</div>
              <button className="btn sec sm" onClick={() => reload()}>Try again</button>
            </div>
          ) : status === "loading" ? (
            <div className="stack" aria-busy="true">
              <div className="skel" style={{ height: 56, width: 320 }} />
              <div className="skel" style={{ height: 120 }} />
              <div className="skel" style={{ height: 360 }} />
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
