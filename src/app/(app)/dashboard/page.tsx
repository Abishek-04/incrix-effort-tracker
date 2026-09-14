"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useData, useMonth } from "@/components/DataProvider";
import { Icon, type IconName } from "@/components/Icon";
import { Avatar, EmptyState, LoadError, MonthNav, PageHead, PerfPill, SkeletonRows } from "@/components/ui";
import { DEPTS, UIUX } from "@/lib/types";
import { daysIn, dateLabel, fmt, monthLabel, perfStatus, shiftMonth, sum, todayISO, workingDays, workingDaysBetween } from "@/lib/utils";

type SortKey = "name" | "dept" | "p" | "pct" | "days";

export default function DashboardPage() {
  const { team, rateById, viewMonth, pts, memberName } = useData();
  const router = useRouter();
  const { entries: es, loading, error, retry } = useMonth(viewMonth);
  const prevYM = shiftMonth(viewMonth, -1);
  const prev = useMonth(prevYM);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "p", dir: -1 });
  const [dept, setDept] = useState("");

  const today = todayISO(), isCur = viewMonth === today.slice(0, 7);
  const wdT = workingDays(viewMonth, false), wdE = workingDays(viewMonth, true), pace = wdT ? wdE / wdT : 0;
  const active = team.filter((m) => m.active);

  const all = active.map((m) => {
    const mine = es.filter((e) => e.memberId === m.id);
    const p = sum(mine, pts);
    return { ...m, p, n: mine.length, days: new Set(mine.map((e) => e.date)).size, pct: m.target ? p / m.target : 0, perf: perfStatus(p, m.target, viewMonth) };
  });
  const total = sum(es, pts), target = sum(active, (m) => m.target), expected = target * pace;
  const contributors = all.filter((r) => r.n).length, hours = sum(es, (e) => e.hours ?? 0);
  const cutoff = isCur ? Number(today.slice(8)) : 31;
  const prevTotal = sum(prev.entries.filter((e) => Number(e.date.slice(8)) <= cutoff), pts);
  const delta = prevTotal ? ((total - prevTotal) / prevTotal) * 100 : null;
  const teamPerf = perfStatus(total, target, viewMonth);

  const rows = all
    .filter((r) => !dept || r.dept === dept)
    .sort((a, b) => {
      const x = sort.k === "name" || sort.k === "dept" ? a[sort.k].toLowerCase() : a[sort.k];
      const y = sort.k === "name" || sort.k === "dept" ? b[sort.k].toLowerCase() : b[sort.k];
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || b.p - a.p;
    });
  const sortBy = (k: SortKey) => setSort((s) => ({ k, dir: s.k === k ? (-s.dir as 1 | -1) : k === "name" || k === "dept" ? 1 : -1 }));
  const SortTh = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => (
    <th className={num ? "num" : ""} aria-sort={sort.k === k ? (sort.dir < 0 ? "descending" : "ascending") : "none"}>
      <button className={`sortbtn${sort.k === k ? " on" : ""}`} onClick={() => sortBy(k)}>
        {label}{sort.k === k && <Icon name={sort.dir < 0 ? "chevD" : "chevU"} size={12} />}
      </button>
    </th>
  );

  const depts = DEPTS.map((d) => { const de = es.filter((e) => e.dept === d); return { d, p: sum(de, pts), n: de.length }; }).sort((a, b) => b.p - a.p);
  const dmax = Math.max(1, ...depts.map((x) => x.p));
  const uiux = sum(es.filter((e) => rateById.get(e.typeId)?.group === UIUX), pts);
  const weeks: { l: string; p: number; n: number; now: boolean }[] = [];
  for (let from = 1; from <= daysIn(viewMonth); from += 7) {
    const to = Math.min(from + 6, daysIn(viewMonth));
    const we = es.filter((e) => { const d = Number(e.date.slice(8)); return d >= from && d <= to; });
    const day = Number(today.slice(8));
    weeks.push({ l: `${from}–${to}`, p: sum(we, pts), n: we.length, now: isCur && day >= from && day <= to });
  }
  const wmax = Math.max(1, ...weeks.map((w) => w.p));

  const attention: { key: string; name: string; icon: IconName; cls: string; text: string }[] = [];
  es.filter((e) => e.status === "Blocked").forEach((e) => attention.push({ key: `b${e.id}`, name: memberName(e), icon: "warn", cls: "bad", text: `Blocked: ${e.desc}` }));
  if (!prev.loading) {
    active.forEach((m) => {
      const mine = es.filter((e) => e.memberId === m.id);
      if (isCur) {
        const last = [...mine, ...prev.entries.filter((e) => e.memberId === m.id)].map((e) => e.date).filter((d) => d <= today).sort().pop();
        if (!mine.length && wdE > 1) attention.push({ key: m.id, name: m.name, icon: "alert", cls: "bad", text: last ? `No entries this month · last ${dateLabel(last, { day: "numeric", month: "short" })}` : "No entries logged this month" });
        else if (last) {
          const gap = workingDaysBetween(last, today);
          if (gap >= 2) attention.push({ key: m.id, name: m.name, icon: "clock", cls: "warn", text: `Last logged ${dateLabel(last, { day: "numeric", month: "short" })} · ${gap} working days ago` });
        }
      } else if (!mine.length && viewMonth < today.slice(0, 7)) {
        attention.push({ key: m.id, name: m.name, icon: "alert", cls: "bad", text: `No entries in ${monthLabel(viewMonth, true)}` });
      }
    });
  }

  return (
    <>
      <PageHead title="Dashboard" sub={`${monthLabel(viewMonth)} · ${wdE} of ${wdT} working days elapsed`} actions={<MonthNav />} />
      {error && <LoadError message={error} onRetry={retry} />}

      <div className="kpis">
        <div className="card kpi">
          <div className="k-h"><span className="k-i"><Icon name="trend" size={16} /></span>Points logged</div>
          <div className="k-v">{loading ? "—" : fmt(total)}</div>
          <div className="k-f">
            {delta === null ? `No data for ${monthLabel(prevYM, true)}` : (
              <><span className={`delta ${delta >= 0 ? "up" : "down"}`}><Icon name={delta >= 0 ? "chevU" : "chevD"} size={12} />{Math.abs(Math.round(delta))}%</span> vs {monthLabel(prevYM, true)}{isCur ? " (same period)" : ""}</>
            )}
          </div>
        </div>
        <div className="card kpi">
          <div className="k-h"><span className="k-i"><Icon name="target" size={16} /></span>Team target</div>
          <div className="k-v">{target ? Math.round((total / target) * 100) : 0}%<small> of {fmt(target)}</small></div>
          <div className="progress" style={{ marginBottom: 8 }} data-tip={`Marker = expected progress by today (${fmt(expected)} pts)`}>
            <i className={teamPerf.cls} style={{ width: `${target ? Math.min(100, (total / target) * 100) : 0}%` }} />
            {wdE > 0 && <span className="pace" style={{ left: `${pace * 100}%` }} />}
          </div>
          <div className="k-f"><PerfPill perf={teamPerf} /> Expected {fmt(expected)} pts by now</div>
        </div>
        <div className="card kpi">
          <div className="k-h"><span className="k-i"><Icon name="users" size={16} /></span>Active contributors</div>
          <div className="k-v">{contributors}<small> / {active.length}</small></div>
          <div className="k-f">{active.length - contributors ? `${active.length - contributors} ${active.length - contributors === 1 ? "member hasn't" : "members haven't"} logged yet` : "Everyone has logged work"}</div>
        </div>
        <div className="card kpi">
          <div className="k-h"><span className="k-i"><Icon name="file" size={16} /></span>Entries</div>
          <div className="k-v">{es.length}</div>
          <div className="k-f">{fmt(hours)} hrs recorded · avg {fmt(es.length ? total / es.length : 0)} pts/entry</div>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-h">
            <div><h2>Team performance</h2><p>Points against monthly target. The marker on each bar shows expected progress to date. Click a row to see entries.</p></div>
            <select style={{ width: "auto", minWidth: 170 }} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
              <option value="">All departments</option>
              {DEPTS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          {loading ? <SkeletonRows rows={6} /> : rows.length ? (
            <div className="tablewrap">
              <table className="t perf">
                <thead><tr><SortTh k="name" label="Member" /><SortTh k="dept" label="Department" /><SortTh k="p" label="Points vs target" /><SortTh k="pct" label="Attainment" num /><SortTh k="days" label="Days logged" num /><th>Status</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const open = () => router.push(`/entries?member=${r.id}`);
                    return (
                      <tr key={r.id} className="click" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}>
                        <td><div className="who"><Avatar name={r.name} /><div style={{ minWidth: 0 }}><b>{r.name}</b><small>{r.role}</small></div></div></td>
                        <td><span className="tag">{r.dept}</span></td>
                        <td>
                          <div className="perfbar">
                            <div className="progress" data-tip={`${fmt(r.p)} of ${fmt(r.target)} pts\nExpected by today: ${fmt(r.target * pace)} pts`}>
                              <i className={r.perf.cls} style={{ width: `${Math.min(100, r.pct * 100)}%` }} />
                              {wdE > 0 && <span className="pace" style={{ left: `${pace * 100}%` }} />}
                            </div>
                            <span><b>{fmt(r.p)}</b> <span className="muted">/ {fmt(r.target)}</span></span>
                          </div>
                        </td>
                        <td className="num"><b>{Math.round(r.pct * 100)}%</b></td>
                        <td className="num">{r.days} <span className="muted">/ {wdE}</span></td>
                        <td><PerfPill perf={r.perf} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="users" title="No active members">No active members in {dept || "this team"}.</EmptyState>
          )}
        </div>

        <div className="cols-3">
          <div className="card">
            <div className="card-h"><div><h2>Points by department</h2><p>{uiux ? `Includes ${fmt(uiux)} pts of ${UIUX} work in Software` : "Share of total points this month"}</p></div></div>
            <div className="card-b">
              {total ? (
                <div className="hbars">
                  {depts.map((x) => (
                    <div key={x.d} className="hbar" data-tip={`${x.d}: ${fmt(x.p)} pts · ${x.n} entries`}>
                      <span>{x.d}</span>
                      <span className="track"><i style={{ width: `${(x.p / dmax) * 100}%` }} /></span>
                      <span className="v">{fmt(x.p)}<small>{Math.round((x.p / total) * 100)}%</small></span>
                    </div>
                  ))}
                </div>
              ) : <EmptyState icon="dash" title="No points yet">Department totals appear once work is logged.</EmptyState>}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><div><h2>Weekly trend</h2><p>Points per week (by day of month)</p></div></div>
            <div className="card-b">
              <div className="cols">
                {weeks.map((w) => (
                  <div key={w.l} className={`col${w.now ? " now" : ""}`} data-tip={`Days ${w.l}: ${fmt(w.p)} pts · ${w.n} entries${w.now ? "\nCurrent week" : ""}`}>
                    <b>{w.p ? fmt(w.p) : ""}</b>
                    <i style={{ height: `${(w.p / wmax) * 78}%` }} />
                  </div>
                ))}
              </div>
              <div className="colx">{weeks.map((w) => <span key={w.l}>{w.l}</span>)}</div>
            </div>
          </div>
          <div className="card span-all">
            <div className="card-h">
              <div><h2>Needs attention</h2><p>{isCur ? "Blocked work and members who haven't logged recently" : "Blocked work and members with no entries"}</p></div>
              {attention.length > 0 && <span className="pill bad">{attention.length}</span>}
            </div>
            {attention.length ? (
              <div className="alist">
                {attention.slice(0, 7).map((a) => (
                  <div key={a.key} className="aitem">
                    <Avatar name={a.name} sm />
                    <div className="grow">
                      <b style={{ display: "block", fontWeight: 600 }}>{a.name}</b>
                      <div className="meta" style={{ margin: 0 }}>
                        <span className={`pill ${a.cls}`} style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}><Icon name={a.icon} size={12} />{a.text}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {attention.length > 7 && <div className="aitem muted" style={{ fontSize: 12.5 }}>+ {attention.length - 7} more</div>}
              </div>
            ) : (
              <EmptyState icon="checkc" title="All clear">Nothing blocked and everyone is logging regularly.</EmptyState>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
