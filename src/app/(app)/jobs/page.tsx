"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Icon } from "@/components/Icon";
import { Avatar, EmptyState, PageHead } from "@/components/ui";
import { useUI } from "@/components/UIProvider";
import { CONFIRM_ABOVE_POINTS } from "@/lib/rules";
import type { Job } from "@/lib/types";
import { dateLabel, fmt, hoursLabel } from "@/lib/utils";

const errMsg = (e: unknown) => (e as Error).message;

/** Job cards: one deliverable, one pot of points, split between whoever worked on it. */
export default function JobsPage() {
  const { jobs, rates } = useData();
  const [show, setShow] = useState<"Open" | "Done">("Open");
  const list = jobs.filter((j) => j.status === show);
  const open = jobs.filter((j) => j.status === "Open");

  return (
    <>
      <PageHead
        title="Job cards"
        sub={`One card per deliverable. It holds the points once, however many people work on it, and splits them by time spent. Cards worth more than ${CONFIRM_ABOVE_POINTS} points count only once an administrator confirms them.`}
        actions={
          <div className="seg" role="group" aria-label="Which cards">
            <button className={show === "Open" ? "on" : ""} onClick={() => setShow("Open")}>Open<span className="count"> {open.length}</span></button>
            <button className={show === "Done" ? "on" : ""} onClick={() => setShow("Done")}>Finished</button>
          </div>
        }
      />
      {!rates.length ? null : list.length ? (
        <div className="jobcards">
          {list.map((job) => <Card key={job.id} job={job} />)}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            icon="layers"
            title={show === "Open" ? "No open job cards" : "Nothing finished yet"}
            action={show === "Open" ? <Link className="btn" href="/log"><Icon name="plus" size={16} />Log work and start a card</Link> : undefined}
          >
            {show === "Open"
              ? "Start one from the log form whenever a deliverable will take more than one sitting or more than one person."
              : "Cards you mark as done appear here."}
          </EmptyState>
        </div>
      )}
    </>
  );
}

function Card({ job }: { job: Job }) {
  const { patchJob, removeJob, rates } = useData();
  const { isAdmin } = useAuth();
  const { toast, confirm } = useUI();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const hours = job.contributions.reduce((a, c) => a + (c.hours || 0), 0);
  const people = new Set(job.contributions.map((c) => c.memberId)).size;
  const rate = rates.find((r) => r.id === job.typeId);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
    } catch (e) {
      toast(errMsg(e), { error: true });
    } finally {
      setBusy(false);
    }
  };

  const close = () =>
    act(() => patchJob(job.id, { status: "Done" }), `“${job.title}” marked done — the split is final`);
  const reopen = () => act(() => patchJob(job.id, { status: "Open" }), `“${job.title}” reopened`);

  const remove = async () => {
    const ok = await confirm({
      title: `Delete “${job.title}”?`,
      body: "The card disappears for everyone. Only cards with nothing logged against them can be deleted.",
      ok: "Delete card", icon: "trash",
    });
    if (ok) act(() => removeJob(job.id), "Card deleted");
  };

  const retype = (typeId: string) => act(() => patchJob(job.id, { typeId }), "Deliverable updated — points re-split");
  const requantify = (qty: number) => act(() => patchJob(job.id, { qty }), "Quantity updated — points re-split");

  return (
    <div className={`jobcard${job.status === "Done" ? " done" : ""}`}>
      <div className="jobcard-h">
        <div style={{ minWidth: 0 }}>
          <h3>
            {job.title}
            {!job.confirmed && <span className="pill warn" style={{ marginLeft: 8, verticalAlign: 2 }}><Icon name="clock" size={11} />Awaiting confirmation</span>}
          </h3>
          <div className="meta">
            {job.client && <><span>{job.client}</span><span>·</span></>}
            <span className="tag">{job.dept}</span>
            <span>{job.typeName}{job.qty !== 1 && ` × ${fmt(job.qty)}`}</span>
            <span>·</span>
            <span>{job.status === "Done" ? `Finished ${job.closedAt ? dateLabel(job.closedAt.slice(0, 10), { day: "numeric", month: "short" }) : ""}` : "Open"}</span>
          </div>
        </div>
        <div className="pot">
          <b>{fmt(job.points)}</b>
          <small>
            points{job.confirmed ? (job.status === "Open" ? " · provisional split" : "") : " · not counting yet"}
          </small>
        </div>
      </div>

      {job.contributions.length ? (
        <div style={{ display: "grid", gap: 10 }}>
          {[...job.contributions].sort((a, b) => b.points - a.points || a.date.localeCompare(b.date)).map((c) => (
            <div key={c.entryId} className="splitrow">
              <div className="who">
                <Avatar name={c.memberName} sm />
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontWeight: 600 }}>{c.memberName}</b>
                  <div className="meta" style={{ margin: 0 }}>{dateLabel(c.date, { day: "numeric", month: "short" })} · {hoursLabel(c.hours)}</div>
                </div>
              </div>
              <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <b style={job.confirmed ? undefined : { color: "var(--ink-3)" }}>{fmt(c.points)}</b>{" "}
                <span className="muted">pts · {Math.round(c.share * 100)}%{job.confirmed ? "" : " · pending"}</span>
              </div>
              <span className="bar"><i style={{ width: `${Math.round(c.share * 100)}%` }} /></span>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 12.5 }}>
            {people} {people === 1 ? "person" : "people"} · {hoursLabel(hours)} logged · {rate ? `${fmt(rate.rate)} pts ${rate.unit}` : "work type removed"}
            {!job.confirmed && ` · worth more than ${CONFIRM_ABOVE_POINTS} pts, so it needs confirming before it counts`}
          </div>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 13 }}>Nothing logged against this card yet.</div>
      )}

      {editing && (
        <div className="fgrid" style={{ borderTop: "1px solid var(--line-2)", paddingTop: 14 }}>
          <div>
            <label className="lbl" htmlFor={`t-${job.id}`}>Deliverable</label>
            <select id={`t-${job.id}`} value={job.typeId} onChange={(e) => retype(e.target.value)} disabled={busy}>
              {rates.filter((r) => r.dept === job.dept).map((r) => (
                <option key={r.id} value={r.id}>{r.type} — {fmt(r.rate)} pts {r.unit}</option>
              ))}
            </select>
            <div className="help">Upgrading a reel to premium re-splits the same card at the new rate.</div>
          </div>
          <div>
            <label className="lbl" htmlFor={`q-${job.id}`}>Quantity</label>
            <input id={`q-${job.id}`} type="number" min={0.5} step={0.5} defaultValue={job.qty} disabled={busy}
              onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v !== job.qty) requantify(v); }} />
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {job.status === "Open" ? (
          <>
            <Link className="btn sec sm" href="/log"><Icon name="plus" size={14} />Log time to this</Link>
            <button className="btn sm" onClick={close} disabled={busy || !job.contributions.length}><Icon name="check" size={14} />Mark done</button>
          </>
        ) : (
          <button className="btn sec sm" onClick={reopen} disabled={busy}><Icon name="refresh" size={14} />Reopen</button>
        )}
        {isAdmin && (job.confirmed
          ? job.confirmedBy !== "automatic" && (
              <button className="btn ghost sm" onClick={() => act(() => patchJob(job.id, { confirmed: false }), "Confirmation withdrawn — the points stop counting")} disabled={busy}>
                <Icon name="eyeOff" size={14} />Withdraw confirmation
              </button>
            )
          : (
            <button className="btn sm" onClick={() => act(() => patchJob(job.id, { confirmed: true }), `“${job.title}” confirmed — the points now count`)} disabled={busy}>
              <Icon name="shield" size={14} />Confirm this card
            </button>
          ))}
        <button className="btn ghost sm" onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Change deliverable"}</button>
        <div className="spacer" style={{ flex: 1 }} />
        {isAdmin && !job.contributions.length && (
          <button className="iconbtn del" onClick={remove} disabled={busy} data-tip="Delete card" aria-label={`Delete ${job.title}`}><Icon name="trash" size={16} /></button>
        )}
      </div>
    </div>
  );
}
