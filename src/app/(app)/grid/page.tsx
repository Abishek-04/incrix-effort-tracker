"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useData, useMonth } from "@/components/DataProvider";
import { Avatar, EmptyState, LoadError, MonthNav, PageHead, SkeletonRows } from "@/components/ui";
import { DEPTS } from "@/lib/types";
import { dateLabel, daysIn, fmt, isoOf, isWeekend, todayISO, workingDays } from "@/lib/utils";

export default function GridPage() {
  const { team, viewMonth, pts } = useData();
  const router = useRouter();
  const { entries: es, loading, error, retry } = useMonth(viewMonth);
  const [dept, setDept] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const today = todayISO();
  const wdT = workingDays(viewMonth, false), wdE = workingDays(viewMonth, true);
  const members = team.filter((m) => m.active && (!dept || m.dept === dept));
  const shownIds = new Set(members.map((m) => m.id));

  const cellMap = useMemo(() => {
    const map = new Map<string, { p: number; n: number }>();
    for (const e of es) {
      const k = `${e.memberId}|${e.date}`;
      const c = map.get(k) ?? { p: 0, n: 0 };
      c.p += pts(e);
      c.n++;
      map.set(k, c);
    }
    return map;
  }, [es, pts]);

  const days = Array.from({ length: daysIn(viewMonth) }, (_, i) => {
    const iso = isoOf(viewMonth, i + 1);
    return { d: i + 1, iso, we: isWeekend(viewMonth, i + 1), today: iso === today, dow: dateLabel(iso, { weekday: "short" }).slice(0, 2) };
  });

  // Keep today (plus a few days of context) in view.
  useEffect(() => {
    const w = wrapRef.current, th = w?.querySelector<HTMLElement>("thead th.today");
    if (w && th) w.scrollLeft = Math.max(0, th.offsetLeft + th.offsetWidth * 4 - w.clientWidth);
  }, [viewMonth, loading, dept]);

  const open = (memberId: string, date: string) => router.push(`/entries?member=${memberId}&date=${date}`);

  let loggedWorkingDays = 0;
  const rows = members.map((m) => {
    const daily = wdT ? m.target / wdT : 0;
    let count = 0, total = 0;
    const cells = days.map((d) => {
      const c = cellMap.get(`${m.id}|${d.iso}`);
      const tc = d.today ? " todaycol" : "";
      const label = `${m.name} · ${dateLabel(d.iso)}`;
      if (c) {
        count++;
        total += c.p;
        if (!d.we) loggedWorkingDays++;
        const lvl = c.p >= daily ? 3 : c.p >= daily / 2 ? 2 : 1;
        return (
          <td key={d.iso} className={`l${lvl}${tc}`} tabIndex={0}
            data-tip={`${label}\n${fmt(c.p)} pts · ${c.n} ${c.n === 1 ? "entry" : "entries"}\nDaily target ≈ ${fmt(daily)} pts`}
            onClick={() => open(m.id, d.iso)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(m.id, d.iso); } }}>
            {fmt(c.p)}
          </td>
        );
      }
      if (d.we) return <td key={d.iso} className={`we${tc}`} />;
      if (d.iso < today) return <td key={d.iso} className={`miss${tc}`} data-tip={`${label}\nNothing logged`}>–</td>;
      return <td key={d.iso} className={tc.trim()} />;
    });
    return { m, cells, count, total };
  });
  const compliance = members.length && wdE ? Math.round((loggedWorkingDays / (members.length * wdE)) * 100) : 0;
  const shown = es.filter((e) => shownIds.has(e.memberId));

  return (
    <>
      <PageHead
        title="Daily grid"
        sub={wdE ? <>Who logged on which day · <b>{loading ? "—" : `${compliance}%`}</b> logging compliance on elapsed working days</> : "Who logged on which day · this month hasn't started yet"}
        actions={<MonthNav />}
      />
      {error && <LoadError message={error} onRetry={retry} />}
      <div className="card">
        <div className="toolbar">
          <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
            <option value="">All departments</option>
            {DEPTS.map((d) => <option key={d}>{d}</option>)}
          </select>
          <div className="spacer" />
          <div className="legend">
            <span><i style={{ background: "var(--heat1)" }} />Under half daily target</span>
            <span><i style={{ background: "var(--heat2)" }} />Half or more</span>
            <span><i style={{ background: "var(--heat3)" }} />Daily target met</span>
            <span><i style={{ background: "var(--bad-soft)" }} />Missed</span>
            <span><i style={{ background: "repeating-linear-gradient(135deg,var(--surface-2) 0 3px,var(--surface-3) 3px 5px)" }} />Weekend</span>
          </div>
        </div>
        {loading ? <SkeletonRows rows={8} height={32} /> : members.length ? (
          <div className="gridwrap" ref={wrapRef}>
            <table className="grid">
              <thead>
                <tr>
                  <th className="m">Member</th>
                  {days.map((d) => (
                    <th key={d.iso} className={`${d.we ? "wk" : ""}${d.today ? " today" : ""}`} aria-current={d.today ? "date" : undefined}>
                      {d.d}<small>{d.dow}</small>
                    </th>
                  ))}
                  <th className="tot">Days</th>
                  <th className="tot">Points</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ m, cells, count, total }) => (
                  <tr key={m.id}>
                    <td className="m"><div className="who"><Avatar name={m.name} sm /><div style={{ minWidth: 0 }}><b>{m.name}</b></div></div></td>
                    {cells}
                    <td className="tot">{count}<span className="muted" style={{ fontWeight: 500 }}>/{wdE}</span></td>
                    <td className="tot">{fmt(total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="m">Team total</td>
                  {days.map((d) => {
                    const p = shown.filter((e) => e.date === d.iso).reduce((a, e) => a + pts(e), 0);
                    return <td key={d.iso} className={d.today ? "todaycol" : ""}>{p ? fmt(p) : ""}</td>;
                  })}
                  <td className="tot" />
                  <td className="tot">{fmt(shown.reduce((a, e) => a + pts(e), 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <EmptyState icon="users" title="No members to show">Try a different department filter.</EmptyState>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: "12px 4px 0" }}>
        Click any logged cell to open that day&apos;s entries. Daily target = monthly target ÷ working days.
      </p>
    </>
  );
}
