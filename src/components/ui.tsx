"use client";

import type { ReactNode } from "react";
import type { Status } from "@/lib/types";
import { initials, monthLabel, shiftMonth, todayISO, type Perf } from "@/lib/utils";
import { useData } from "./DataProvider";
import { Icon, type IconName } from "./Icon";

export function PageHead({ title, sub, actions }: { title: ReactNode; sub: ReactNode; actions?: ReactNode }) {
  return (
    <div className="phead">
      <div><h1>{title}</h1><p className="sub">{sub}</p></div>
      <div className="pactions">{actions}</div>
    </div>
  );
}

export function MonthNav({ onChange }: { onChange?: () => void }) {
  const { viewMonth, setViewMonth } = useData();
  const current = todayISO().slice(0, 7);
  const go = (m: string) => { setViewMonth(m); onChange?.(); };
  return (
    <>
      {viewMonth !== current && <button className="btn ghost sm" onClick={() => go(current)}>Go to current month</button>}
      <div className="monthnav">
        <button onClick={() => go(shiftMonth(viewMonth, -1))} aria-label="Previous month" data-tip="Previous month"><Icon name="chevL" size={16} /></button>
        <span>{monthLabel(viewMonth)}</span>
        <button onClick={() => go(shiftMonth(viewMonth, 1))} aria-label="Next month" data-tip="Next month"><Icon name="chevR" size={16} /></button>
      </div>
    </>
  );
}

export const STATUS_META: Record<Status, { cls: string; icon: IconName }> = {
  Done: { cls: "ok", icon: "check" },
  "In Progress": { cls: "warn", icon: "clock" },
  Blocked: { cls: "bad", icon: "alert" },
};

export function StatusPill({ status }: { status: Status }) {
  const m = STATUS_META[status] ?? { cls: "", icon: "clock" };
  return <span className={`pill ${m.cls}`}><Icon name={m.icon} size={12} />{status}</span>;
}

export function PerfPill({ perf }: { perf: Perf }) {
  return <span className={`pill ${perf.cls}`}><Icon name={perf.icon} size={12} />{perf.label}</span>;
}

export function Avatar({ name, sm }: { name: string; sm?: boolean }) {
  return <span className={`av${sm ? " sm" : ""}`} aria-hidden="true">{initials(name)}</span>;
}

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ei"><Icon name={icon} size={22} /></div>
      <b>{title}</b>
      {children && <div>{children}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="errorbox" role="alert">
      <Icon name="alert" />
      <div><b>Couldn&apos;t load entries</b>{message}</div>
      <button className="btn sec sm" onClick={onRetry}>Try again</button>
    </div>
  );
}

export function SkeletonRows({ rows = 6, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div style={{ display: "grid", gap: 10, padding: 20 }} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skel" style={{ height }} />)}
    </div>
  );
}
