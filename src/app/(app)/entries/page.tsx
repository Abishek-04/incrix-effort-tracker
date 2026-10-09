"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useData, useMonth } from "@/components/DataProvider";
import { EntryActions } from "@/components/EntryActions";
import { Icon } from "@/components/Icon";
import { Avatar, EmptyState, LoadError, MonthNav, PageHead, SkeletonRows, StatusPill } from "@/components/ui";
import { useUI } from "@/components/UIProvider";
import { DEPTS, STATUSES, UIUX, type Entry } from "@/lib/types";
import { isPending, pendingPointsOf } from "@/lib/rules";
import { csvDownload, dateLabel, fmt, hoursInput, hoursLabel, logLagDays, monthLabel, stampLabel, sum } from "@/lib/utils";

type SortKey = "date" | "member" | "type" | "qty" | "pts" | "hours" | "status" | "logged";
const FILTER_KEYS = ["member", "dept", "status", "q", "date"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

/** "Same day" or "3 days later" — how long after the work it reached the log. */
function lagLabel(e: Entry) {
  const lag = logLagDays(e.date, e.createdAt);
  return lag === 0 ? "Same day" : lag === 1 ? "Next day" : `${lag} days later`;
}

export default function EntriesPage() {
  return (
    <Suspense fallback={null}>
      <Entries />
    </Suspense>
  );
}

function Entries() {
  const { team, memberById, rateById, jobById, viewMonth, setViewMonth, pts, memberName } = useData();
  const { toast } = useUI();
  const params = useSearchParams();
  const { entries, loading, error, retry } = useMonth(viewMonth);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "date", dir: -1 });
  const [limit, setLimit] = useState(50);

  // Filters live in the URL so dashboard/grid links and the back button work.
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ""])) as Record<FilterKey, string>;
  const setFilter = (patch: Partial<Record<FilterKey, string>>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) v ? sp.set(k, v) : sp.delete(k);
    const qs = sp.toString();
    window.history.replaceState(null, "", `/entries${qs ? `?${qs}` : ""}`);
    setLimit(50);
  };

  useEffect(() => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.date.slice(0, 7) !== viewMonth) setViewMonth(f.date.slice(0, 7));
  }, [f.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeName = (e: Entry) => rateById.get(e.typeId)?.type ?? e.typeName;
  const q = f.q.toLowerCase();
  const filtered = entries.filter(
    (e) =>
      (!f.member || e.memberId === f.member) &&
      (!f.dept || e.dept === f.dept) &&
      (!f.status || e.status === f.status) &&
      (!f.date || e.date === f.date) &&
      (!q || [e.desc, e.client, typeName(e), memberName(e)].join(" ").toLowerCase().includes(q)),
  );
  const val = (e: Entry): string | number =>
    sort.k === "pts" ? pts(e) : sort.k === "qty" ? e.qty : sort.k === "hours" ? (e.hours ?? -1) : sort.k === "logged" ? e.createdAt
      : sort.k === "member" ? memberName(e).toLowerCase() : sort.k === "type" ? typeName(e).toLowerCase() : sort.k === "status" ? e.status : e.date;
  const sorted = [...filtered].sort((a, b) => {
    const x = val(a), y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
  });
  const shown = sorted.slice(0, limit);
  // A member sees their department's work; the points on it belong to the person who did it.
  const someoneElses = entries.some((e) => e.masked);
  // Without the full team list, the member filter is built from the names actually on screen.
  const filterMembers = team.length > 1
    ? team.map((m) => ({ id: m.id, name: m.name }))
    : [...new Map(entries.map((e) => [e.memberId, { id: e.memberId, name: memberName(e) }])).values()].sort((a, b) => a.name.localeCompare(b.name));

  const chips: [FilterKey, string][] = [];
  if (f.date) chips.push(["date", dateLabel(f.date)]);
  if (f.member) chips.push(["member", memberById.get(f.member)?.name ?? "Removed member"]);
  if (f.dept) chips.push(["dept", f.dept]);
  if (f.status) chips.push(["status", f.status]);
  if (f.q) chips.push(["q", `“${f.q}”`]);
  const clearAll = () => setFilter({ member: "", dept: "", status: "", q: "", date: "" });

  const sortBy = (k: SortKey) => setSort((s) => ({ k, dir: s.k === k ? (-s.dir as 1 | -1) : ["member", "type", "status"].includes(k) ? 1 : -1 }));
  const Th = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => (
    <th className={num ? "num" : ""} aria-sort={sort.k === k ? (sort.dir < 0 ? "descending" : "ascending") : "none"}>
      <button className={`sortbtn${sort.k === k ? " on" : ""}`} onClick={() => sortBy(k)}>
        {label}{sort.k === k && <Icon name={sort.dir < 0 ? "chevD" : "chevU"} size={12} />}
      </button>
    </th>
  );

  const exportCsv = () => {
    if (!sorted.length) return toast("Nothing to export for these filters", { error: true });
    const rows = sorted.map((e) => {
      const r = rateById.get(e.typeId);
      return [
        e.date, e.startTime ?? "", memberName(e), e.dept, typeName(e), r?.group ?? "", e.desc, e.client,
        e.masked ? "" : e.qty, e.masked ? "" : pts(e),
        e.hours ?? "", e.hours == null ? "" : hoursLabel(e.hours), e.jobId ? jobById.get(e.jobId)?.title ?? "Job card" : "",
        e.share === undefined ? "" : `${Math.round(e.share * 100)}%`, e.status, stampLabel(e.createdAt), logLagDays(e.date, e.createdAt),
      ];
    });
    csvDownload(`incrix-log-${viewMonth}.csv`, [
      ["Date", "Started at", "Member", "Department", "Work Type", "Group", "Description", "Client", "Qty", "Points", "Hours", "Time spent", "Job card", "Share", "Status", "Logged at", "Logged after (days)"],
      ...rows,
    ]);
    toast(`Exported ${sorted.length} entries`);
  };

  return (
    <>
      <PageHead title="Entries" sub={someoneElses ? `Your department's work in ${monthLabel(viewMonth)}. Points shown are your own.` : `All work logged in ${monthLabel(viewMonth)}.`} actions={<MonthNav onChange={() => f.date && setFilter({ date: "" })} />} />
      {error && <LoadError message={error} onRetry={retry} />}
      <div className="card">
        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={16} />
            <input type="search" placeholder="Search description, client, member…" value={f.q} onChange={(e) => setFilter({ q: e.target.value })} aria-label="Search entries" />
          </div>
          <select value={f.member} onChange={(e) => setFilter({ member: e.target.value })} aria-label="Filter by member">
            <option value="">All members</option>
            {filterMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={f.dept} onChange={(e) => setFilter({ dept: e.target.value })} aria-label="Filter by department">
            <option value="">All departments</option>
            {DEPTS.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select value={f.status} onChange={(e) => setFilter({ status: e.target.value })} aria-label="Filter by status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <div className="spacer" />
          <button className="btn sec" onClick={exportCsv}><Icon name="download" size={16} />Export CSV</button>
          <Link className="btn" href="/log"><Icon name="plus" size={16} />New entry</Link>
        </div>

        <div className="toolbar" style={{ padding: "10px 20px", gap: 8, background: "var(--surface-2)" }}>
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
            <b style={{ color: "var(--ink)" }}>{sorted.length}</b> {sorted.length === 1 ? "entry" : "entries"} ·{" "}
            <b style={{ color: "var(--ink)" }}>{fmt(sum(sorted, pts))}</b> {someoneElses ? "of your pts" : "pts"} · {fmt(sum(sorted, (e) => e.hours ?? 0))} hrs
          </span>
          {chips.length > 0 && (
            <>
              <span className="muted" style={{ marginLeft: 8 }}><Icon name="filter" size={13} /></span>
              {chips.map(([k, label]) => (
                <button key={k} className="chip on" style={{ height: 26, fontSize: 12 }} onClick={() => setFilter({ [k]: "" })} aria-label={`Remove filter ${label}`}>
                  {label}<Icon name="x" size={12} />
                </button>
              ))}
              <button className="btn ghost sm" onClick={clearAll}>Clear all</button>
            </>
          )}
        </div>

        {loading ? <SkeletonRows rows={8} /> : sorted.length ? (
          <>
            <div className="tablewrap">
              <table className="t entries">
                <thead>
                  <tr>
                    <Th k="date" label="Date" /><Th k="member" label="Member" /><th>Work</th><Th k="type" label="Type" />
                    <Th k="qty" label="Qty" num /><Th k="pts" label="Points" num /><Th k="hours" label="Time" num /><Th k="status" label="Status" /><Th k="logged" label="Logged" />
                    <th className="act"><span className="sr">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => {
                    const r = rateById.get(e.typeId);
                    return (
                      <tr key={e.id}>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <b>{dateLabel(e.date, { day: "numeric", month: "short" })}</b>
                          <div className="meta">{e.startTime ?? dateLabel(e.date, { weekday: "short" })}</div>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}><div className="who"><Avatar name={memberName(e)} sm /><b>{memberName(e)}</b></div></td>
                        <td style={{ minWidth: 180 }}>
                          <div className="desc">{e.desc}</div>
                          {(e.client || e.jobId) && (
                            <div className="meta">
                              {e.client && <span>{e.client}</span>}
                              {e.jobId && (
                                <span className="pill" data-tip={jobById.get(e.jobId) ? `Shared card · ${fmt(jobById.get(e.jobId)!.points)} pts split by time spent` : undefined}>
                                  <Icon name="layers" size={11} />
                                  {jobById.get(e.jobId)?.title ?? "Job card"}
                                  {e.share !== undefined && ` · ${Math.round(e.share * 100)}%`}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ minWidth: 120, maxWidth: 170 }}>
                          <div className="desc">{typeName(e)}</div>
                          <div className="meta">
                            <span className="tag">{r?.group === UIUX ? "UI/UX" : e.dept}</span>
                            {!r && <span className="pill warn">Rate removed</span>}
                          </div>
                        </td>
                        <td className="num">{e.masked ? <span className="muted">—</span> : fmt(e.qty)}</td>
                        <td className="num">
                          {e.masked ? <span className="muted" data-tip="Points stay with the person and the administrator">—</span> : <b>{fmt(pts(e))}</b>}
                          {isPending(e) && <div className="meta" style={{ justifyContent: "flex-end" }} data-tip="The job card needs confirming before these points count"><span className="pill warn">+{fmt(pendingPointsOf(e))} pending</span></div>}
                        </td>
                        <td className="num muted">{e.hours == null ? "—" : hoursInput(e.hours)}</td>
                        <td><StatusPill status={e.status} /></td>
                        <td style={{ whiteSpace: "nowrap" }} className="muted" data-tip={`Logged ${stampLabel(e.createdAt)}${e.updatedAt !== e.createdAt ? `\nEdited ${stampLabel(e.updatedAt)}` : ""}`}>
                          {lagLabel(e)}{e.updatedAt !== e.createdAt && <div className="meta">edited</div>}
                        </td>
                        {/* A colleague's entry is there to be read, not edited or repeated as your own. */}
                        <td className="act">{e.masked ? null : <EntryActions entry={e} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {sorted.length > limit && (
              <div className="card-f">
                <span className="muted">Showing {shown.length} of {sorted.length}</span>
                <button className="btn sec sm" onClick={() => setLimit((l) => l + 50)}>Show {Math.min(50, sorted.length - limit)} more</button>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon="search"
            title="No matching entries"
            action={chips.length ? <button className="btn sec" onClick={clearAll}>Clear filters</button> : <Link className="btn" href="/log"><Icon name="plus" size={16} />Log work</Link>}
          >
            {chips.length ? "Try removing a filter or changing the month." : `Nothing has been logged in ${monthLabel(viewMonth)} yet.`}
          </EmptyState>
        )}
      </div>
    </>
  );
}
