"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useData, useMonth } from "@/components/DataProvider";
import { api } from "@/lib/api";
import { EntryActions } from "@/components/EntryActions";
import { Icon } from "@/components/Icon";
import { Avatar, EmptyState, PageHead, SkeletonRows, StatusPill } from "@/components/ui";
import { useUI } from "@/components/UIProvider";
import { DEPTS, STATUSES, UIUX, type Dept, type Entry, type Rate, type Status } from "@/lib/types";
import { JOIN_WINDOW_DAYS, MAX_HOURS_PER_DAY, canBeShared, isJoinable, looksLikeSameWork } from "@/lib/rules";
import {
  QUICK_CLAIM_RATIO, dateLabel, fmt, hoursInput, hoursLabel, monthLabel, nowHM, parseHours, perfStatus, shiftISO, sum, timeOf,
  todayISO, typicalHoursOf, workingDays,
} from "@/lib/utils";

const LAST_MEMBER_KEY = "incrix-last-member";

type Form = {
  memberId: string;
  date: string;
  dept: Dept | "";
  typeId: string;
  qty: string;
  hours: string;
  startTime: string;
  /** "" = a one-off entry, "new" = create a card on save, otherwise an existing card's id. */
  jobId: string;
  jobTitle: string;
  desc: string;
  client: string;
  status: Status;
};

export default function LogPage() {
  return (
    <Suspense fallback={null}>
      <LogWork />
    </Suspense>
  );
}

function Step({ n, done, title, aside }: { n: number; done: boolean; title: string; aside?: string | false }) {
  return (
    <div className="fsec-h">
      <span className={`n${done ? " done" : ""}`}>{done ? <Icon name="check" size={13} /> : n}</span>
      <h3>{title}</h3>
      {aside && <span className="aside">{aside}</span>}
    </div>
  );
}

function LogWork() {
  const { team, rates, jobs, jobById, memberById, rateById, saveEntry, addJob, shareEntry, ensureMonth, pts } = useData();
  const { user, isMember } = useAuth();
  const { toast } = useUI();
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get("edit"), repeatId = params.get("repeat"), srcMonth = params.get("month");
  const today = todayISO();

  const blank = (memberId: string, keep?: Partial<Form>): Form => ({
    memberId, date: today, dept: memberById.get(memberId)?.dept ?? "", typeId: "", qty: "1", hours: "", startTime: nowHM(),
    jobId: "", jobTitle: "", desc: "", client: "", status: "Done", ...keep,
  });
  const [form, setForm] = useState<Form>(() => {
    // A personal login can only log its owner's work, so start on them.
    if (isMember && user.memberId) return blank(user.memberId);
    let last = "";
    try { last = localStorage.getItem(LAST_MEMBER_KEY) ?? ""; } catch {}
    return blank(memberById.has(last) ? last : "");
  });
  const [editing, setEditing] = useState<{ id: string; prevMonth: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [jobQuery, setJobQuery] = useState("");
  const [candidates, setCandidates] = useState<Entry[]>([]);
  const memberRef = useRef<HTMLSelectElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const hoursRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const applied = useRef<string | null>(null);

  // Refreshed whenever the date moves, so the picker always covers the fortnight before it.
  useEffect(() => {
    let live = true;
    api.joinable(shiftISO(form.date, -JOIN_WINDOW_DAYS), form.date)
      .then((r) => live && setCandidates(r.entries))
      .catch(() => {});
    return () => { live = false; };
  }, [form.date]);

  const src = useMonth(srcMonth && /^\d{4}-\d{2}$/.test(srcMonth) ? srcMonth : today.slice(0, 7));
  const cur = useMonth(form.date.slice(0, 7));

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  // Load an entry into the form for ?edit=<id> or ?repeat=<id>.
  useEffect(() => {
    const key = editId ?? repeatId;
    if (!key) {
      if (applied.current) { applied.current = null; setEditing(null); setForm((f) => blank(f.memberId)); }
      return;
    }
    if (applied.current === key || src.loading) return;
    applied.current = key;
    const e = src.entries.find((x) => x.id === key);
    if (!e) { toast("That entry couldn't be found — it may have been deleted", { error: true }); return; }
    setForm({
      memberId: e.memberId, date: editId ? e.date : today, dept: e.dept, typeId: e.typeId, qty: String(e.qty),
      hours: e.hours == null ? "" : hoursInput(e.hours), startTime: editId ? e.startTime || timeOf(e.createdAt) : nowHM(),
      jobId: e.jobId ?? "", jobTitle: "", desc: e.desc, client: e.client, status: editId ? e.status : "Done",
    });
    setEditing(editId ? { id: e.id, prevMonth: e.date.slice(0, 7) } : null);
    if (repeatId) {
      toast("Copied into the form for today — review and save");
      setTimeout(() => descRef.current?.select(), 50);
    }
  }, [editId, repeatId, src.loading, src.entries]); // eslint-disable-line react-hooks/exhaustive-deps

  const member = memberById.get(form.memberId);
  const openJobs = jobs.filter((j) => j.status === "Open" || j.id === form.jobId);
  const job = form.jobId && form.jobId !== "new" && !form.jobId.startsWith("entry:") ? jobById.get(form.jobId) : undefined;
  const creatingJob = form.jobId === "new";
  const types = rates.filter((r) => r.dept === form.dept);
  const groups = [...new Set(types.map((r) => r.group))];
  const rate = rateById.get(job?.typeId ?? form.typeId);
  // Work priced per hour earns by the clock: the time spent is the quantity.
  const hourly = !!rate && /per hour/i.test(rate.unit);
  const hours = parseHours(form.hours) ?? 0;
  const hoursUnreadable = form.hours.trim() !== "" && parseHours(form.hours) === null;
  // Claiming a whole deliverable in a fraction of the time it usually takes is worth a word — never a block.
  // Sharing is only ruled out once a work type is chosen and it turns out to be hourly.
  // With nothing chosen yet, picking the card first is a perfectly good way round the form.
  const shareBlocked = !!rate && !canBeShared(rate);
  // Work logged in the last fortnight that this person could be joining — from every
  // department, because collaboration here crosses them. Fetched on its own so it stays
  // available even though the entries list only shows a member their own department.
  const joinable = candidates.filter((e) => isJoinable(e, rateById.get(e.typeId), form.date)).slice(0, 40);
  const joiningEntry = form.jobId.startsWith("entry:") ? joinable.find((e) => `entry:${e.id}` === form.jobId) : undefined;
  const q = jobQuery.trim().toLowerCase();
  const hit = (...parts: (string | undefined)[]) => !q || parts.filter(Boolean).join(" ").toLowerCase().includes(q);
  const matchingCards = openJobs.filter((j) => hit(j.title, j.client, j.typeName)).slice(0, 6);
  const matchingEntries = joinable
    .filter((e) => hit(e.desc, e.client, memberById.get(e.memberId)?.name ?? e.memberName, rateById.get(e.typeId)?.type))
    .slice(0, q ? 8 : 6);
  const draft = { id: "draft", date: form.date, typeId: form.typeId, client: form.client, desc: form.desc, jobId: undefined } as Entry;
  // Someone else's work that looks like the same thing being logged twice.
  const twin = !form.jobId && form.typeId && form.desc.trim().length > 3
    ? joinable.find((e) => looksLikeSameWork(draft, e, rate))
    : undefined;
  const typical = rate && !job ? typicalHoursOf(rate) : null;
  const quickClaim = !!typical && hours > 0 && hours < typical * QUICK_CLAIM_RATIO;
  const qty = job ? job.qty : hourly ? hours : Number(form.qty) || 0;
  // On a card the entry earns a share of the pot, so the preview weighs this entry's hours
  // against everyone else's time already logged to it.
  const otherHours = job
    ? job.contributions.filter((c) => c.entryId !== editing?.id).reduce((a, c) => a + (c.hours || 0), 0)
    : joiningEntry ? joiningEntry.hours ?? 0
    : 0;
  const pot = job ? job.points : joiningEntry ? pts(joiningEntry) : 0;
  const live = job || joiningEntry
    ? (hours + otherHours > 0 ? (pot * hours) / (hours + otherHours) : pot)
    : rate ? qty * rate.rate : 0;
  const mine = cur.entries.filter((e) => e.memberId === form.memberId);
  const others = mine.filter((e) => e.id !== editing?.id);
  const dayTotal = sum(others.filter((e) => e.date === form.date), pts) + live;
  const monthTotal = sum(others, pts) + live;
  const dayEntries = mine.filter((e) => e.date === form.date);
  const hoursLoggedToday = sum(dayEntries.filter((e) => e.id !== editing?.id), (e) => e.hours ?? 0);
  const overDayLimit = hoursLoggedToday + hours > MAX_HOURS_PER_DAY;
  const ym = form.date.slice(0, 7), wdT = workingDays(ym, false), wdE = workingDays(ym, true);
  const perf = member ? perfStatus(monthTotal, member.target, ym) : null;
  const clients = useMemo(
    () => [...new Set([...cur.entries, ...src.entries].map((e) => e.client).filter(Boolean))].sort(),
    [cur.entries, src.entries],
  );
  const missing = [
    !form.memberId && "team member", !(form.typeId || job || joiningEntry) && "work type", !form.desc.trim() && "description",
    !(qty > 0) && "quantity", !(hours > 0) && "time spent", !form.startTime && "start time",
    creatingJob && !form.jobTitle.trim() && "shared card name",
    overDayLimit && "a day under 14 hours",
  ].filter(Boolean) as string[];
  const modKey = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl";
  const selectable = team.filter((m) => m.active || m.id === form.memberId);
  const yesterday = shiftISO(today, -1);

  const chooseMember = (id: string) => {
    set({ memberId: id, dept: memberById.get(id)?.dept ?? "", typeId: "" });
    try { localStorage.setItem(LAST_MEMBER_KEY, id); } catch {}
  };
  useEffect(() => {
    if (shareBlocked && form.jobId) set({ jobId: "", jobTitle: "" });
  }, [shareBlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseDept = (d: Dept) => {
    set({ dept: d, typeId: "" });
    requestAnimationFrame(() => typeRef.current?.focus());
  };
  const cancelEdit = () => {
    applied.current = null;
    setEditing(null);
    setForm((f) => blank(f.memberId));
    router.replace("/log");
  };

  async function submit(ev?: FormEvent) {
    ev?.preventDefault();
    if (saving) return;
    if (missing.length) {
      (!form.memberId ? memberRef : !form.typeId ? typeRef : !form.desc.trim() ? descRef : !(qty > 0) ? qtyRef : !form.startTime ? startRef : hoursRef).current?.focus();
      return;
    }
    setSaving(true);
    try {
      let jobId = form.jobId;
      if (joiningEntry) {
        const card = await shareEntry(joiningEntry);
        jobId = card.id;
      } else if (creatingJob) {
        const created = await addJob({ title: form.jobTitle.trim(), client: form.client.trim(), typeId: form.typeId, qty });
        jobId = created.id;
      }
      const saved = await saveEntry(
        {
          date: form.date, memberId: form.memberId, typeId: job?.typeId ?? joiningEntry?.typeId ?? form.typeId, desc: form.desc.trim(), client: form.client.trim(),
          qty, hours: Math.round(hours * 60) / 60, startTime: form.startTime, jobId: jobId || undefined, status: form.status,
        },
        editing ?? undefined,
      );
      toast(editing ? `Entry updated · ${fmt(pts(saved))} pts` : `Entry saved · +${fmt(pts(saved))} pts`);
      // Keep the card selected — the next log is usually more time on the same job.
      setForm((f) => blank(f.memberId, { date: f.date, dept: f.dept, jobId: saved.jobId ?? "" }));
      if (editing) { applied.current = null; setEditing(null); router.replace("/log"); }
      requestAnimationFrame(() => typeRef.current?.focus());
    } catch (err) {
      toast((err as Error).message, { error: true });
    } finally {
      setSaving(false);
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); }
  };
  const option = (r: Rate) => <option key={r.id} value={r.id}>{`${r.type} — ${fmt(r.rate)} pts ${r.unit}`}</option>;

  return (
    <>
      <PageHead
        title={editing ? "Edit entry" : "Log work"}
        sub={editing ? "Update the details below and save your changes." : "Record one task per entry. Points are calculated automatically from the rate card."}
        actions={<Link className="btn sec" href="/entries"><Icon name="entries" size={16} />View all entries</Link>}
      />
      <div className="log-layout">
        <div className="stack">
          <form className="card" onSubmit={submit} onKeyDown={onKeyDown} noValidate>
            {editing && (
              <div className="editbanner" style={{ margin: "18px 24px 0" }}>
                <Icon name="log" size={16} /><span>You&apos;re editing an existing entry</span>
                <button type="button" className="btn sm sec" onClick={cancelEdit}>Cancel edit</button>
              </div>
            )}

            <section className="fsec">
              <Step n={1} done={!!form.memberId} title="Who & when" />
              <div className="fgrid">
                <div>
                  <label className="lbl" htmlFor="f-member">Team member <span className="req">*</span></label>
                  <select id="f-member" ref={memberRef} value={form.memberId} onChange={(e) => chooseMember(e.target.value)}>
                    <option value="">Select your name</option>
                    {selectable.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <div className="help">{member ? `${member.role || "No role set"} · ${member.dept}` : "Your last selection is remembered on this device."}</div>
                </div>
                <div>
                  <label className="lbl" htmlFor="f-date">Date <span className="req">*</span></label>
                  <div className="datewrap">
                    <input id="f-date" type="date" value={form.date} max={today} onChange={(e) => { const v = e.target.value || today; set({ date: v > today ? today : v }); }} />
                    <div className="seg">
                      <button type="button" className={form.date === today ? "on" : ""} onClick={() => set({ date: today })}>Today</button>
                      <button type="button" className={form.date === yesterday ? "on" : ""} onClick={() => set({ date: yesterday })}>Yesterday</button>
                    </div>
                  </div>
                  <div className="help">{dateLabel(form.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
                </div>
              </div>
            </section>

            <section className="fsec">
              <Step n={2} done={!!(job || joiningEntry || form.typeId)} title="Type of work" aside={!!member && `Home department: ${member.dept}`} />

              <div className="seg" role="group" aria-label="Kind of log" style={{ marginBottom: 16 }}>
                <button type="button" className={!form.jobId ? "on" : ""} onClick={() => set({ jobId: "", jobTitle: "" })}>Just me</button>
                <button type="button" className={form.jobId ? "on" : ""} disabled={shareBlocked}
                  data-tip={shareBlocked ? "Work priced by the hour is counted by the clock, so there's nothing to share out" : undefined}
                  onClick={() => set({ jobId: joinable[0] ? `entry:${joinable[0].id}` : openJobs[0]?.id ?? "new" })}>
                  Shared with someone
                </button>
              </div>

              {twin && (
                <div className="note" role="status" style={{ marginBottom: 16 }}>
                  <Icon name="layers" size={16} />
                  <div>
                    <b>{memberById.get(twin.memberId)?.name ?? twin.memberName}</b> logged “{twin.desc.slice(0, 60)}” on {dateLabel(twin.date, { day: "numeric", month: "short" })} —
                    the same {rate?.type.split(" (")[0]}{twin.client ? ` for ${twin.client}` : ""}. Same piece of work?
                  </div>
                  <button type="button" className="btn sm" onClick={() => set({ jobId: `entry:${twin.id}` })}>Join it instead</button>
                </div>
              )}

              {form.jobId && (
                <div style={{ marginBottom: 18 }}>
                  <label className="lbl" htmlFor="f-jobsearch">Whose work is this part of? <span className="req">*</span></label>
                  <div className="picker">
                    <div className="search">
                      <Icon name="search" size={16} />
                      <input id="f-jobsearch" type="search" value={jobQuery} onChange={(e) => setJobQuery(e.target.value)}
                        placeholder="Search by name, client or what was done…" autoComplete="off" />
                    </div>
                    <div className="pickerlist" role="listbox" aria-label="Work to join">
                      {matchingCards.map((j) => (
                        <button type="button" key={j.id} role="option" aria-selected={form.jobId === j.id}
                          className={`pickrow${form.jobId === j.id ? " on" : ""}`} onClick={() => set({ jobId: j.id })}>
                          <span className="pickmain"><Icon name="layers" size={13} />{j.title}</span>
                          <span className="pickmeta">
                            {j.client ? `${j.client} · ` : ""}{j.typeName} · {fmt(j.points)} pts · {j.contributions.length} on it
                          </span>
                        </button>
                      ))}
                      {matchingEntries.map((e) => (
                        <button type="button" key={e.id} role="option" aria-selected={form.jobId === `entry:${e.id}`}
                          className={`pickrow${form.jobId === `entry:${e.id}` ? " on" : ""}`} onClick={() => set({ jobId: `entry:${e.id}` })}>
                          <span className="pickmain">
                            <Avatar name={memberById.get(e.memberId)?.name ?? e.memberName} sm />
                            {e.desc.slice(0, 70)}
                          </span>
                          <span className="pickmeta">
                            {memberById.get(e.memberId)?.name ?? e.memberName} · {dateLabel(e.date, { day: "numeric", month: "short" })}
                            {e.client ? ` · ${e.client}` : ""} · {rateById.get(e.typeId)?.type.split(" (")[0]} · {fmt(pts(e))} pts
                          </span>
                        </button>
                      ))}
                      {!matchingCards.length && !matchingEntries.length && (
                        <div className="pickempty">Nothing matches “{jobQuery}”. Start a new shared card below.</div>
                      )}
                    </div>
                    <button type="button" className={`pickrow new${creatingJob ? " on" : ""}`} onClick={() => set({ jobId: "new" })}>
                      <span className="pickmain"><Icon name="plus" size={13} />Start a new shared card</span>
                      <span className="pickmeta">For work you already know two people will be on</span>
                    </button>
                  </div>
                  {creatingJob ? (
                    <div style={{ marginTop: 14 }}>
                      <label className="lbl" htmlFor="f-jobtitle">What is the deliverable? <span className="req">*</span></label>
                      <input id="f-jobtitle" value={form.jobTitle} maxLength={120} placeholder="e.g. Comorin Sudha Goa reel"
                        onChange={(e) => set({ jobTitle: e.target.value })} />
                      <div className="help">Pick the work type and quantity below — the card is worth those points once, however many people work on it.</div>
                    </div>
                  ) : joiningEntry ? (
                    <div className="jobbox">
                      <div>
                        <b>{joiningEntry.desc.slice(0, 70)}</b>
                        <span className="muted"> · {rateById.get(joiningEntry.typeId)?.type}{joiningEntry.client ? ` · ${joiningEntry.client}` : ""}</span>
                      </div>
                      <div>
                        <span className="muted">
                          {memberById.get(joiningEntry.memberId)?.name ?? joiningEntry.memberName} logged {hoursLabel(joiningEntry.hours ?? 0)} on{" "}
                          {dateLabel(joiningEntry.date, { day: "numeric", month: "short" })} and holds all {fmt(pts(joiningEntry))} points.
                        </span>
                      </div>
                      <div className="help">
                        Saving this turns that work into a shared card. The {fmt(pts(joiningEntry))} points are split by time —
                        your {hoursLabel(hours)} against their {hoursLabel(joiningEntry.hours ?? 0)} — instead of being claimed twice.
                      </div>
                    </div>
                  ) : job ? (
                    <div className="jobbox">
                      <div>
                        <b>{job.typeName}</b>
                        <span className="muted"> · worth {fmt(job.points)} pts in total{job.client ? ` · ${job.client}` : ""}</span>
                      </div>
                      {job.contributions.length ? (
                        <ul>
                          {job.contributions.map((c) => (
                            <li key={c.entryId}>
                              <span>{c.memberName}</span>
                              <span className="muted">{dateLabel(c.date, { day: "numeric", month: "short" })} · {hoursLabel(c.hours)}</span>
                              <b>{fmt(c.points)} pts</b>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="muted">Nothing logged to this card yet — you&apos;re first.</div>
                      )}
                      <div className="help">Points are split by time spent, so everyone&apos;s share settles as more work is logged.</div>
                    </div>
                  ) : null}
                </div>
              )}

              {!job && !joiningEntry && (
                <>
              <label className="lbl" id="dept-lbl">Department <span className="req">*</span></label>
              <div className="chips" role="radiogroup" aria-labelledby="dept-lbl" style={{ marginBottom: 18 }}>
                {DEPTS.map((d) => (
                  <button key={d} type="button" role="radio" aria-checked={d === form.dept}
                    className={`chip${d === form.dept ? " on" : ""}${member && d === member.dept && d !== form.dept ? " hint" : ""}`}
                    onClick={() => chooseDept(d)}>
                    {d}<small>{rates.filter((r) => r.dept === d).length}</small>
                  </button>
                ))}
              </div>
              <label className="lbl" htmlFor="f-type">Work type <span className="req">*</span></label>
              <select id="f-type" ref={typeRef} value={form.typeId} disabled={!form.dept} onChange={(e) => set({ typeId: e.target.value })}>
                <option value="">{form.dept ? `Select a ${form.dept} work type` : "Select a department first"}</option>
                {groups.length > 1
                  ? groups.map((g) => <optgroup key={g} label={g || "General"}>{types.filter((r) => r.group === g).map(option)}</optgroup>)
                  : types.map(option)}
              </select>
              {form.dept === "Software" && (
                <div className="help">Software covers <b>Engineering</b> and <b>{UIUX}</b> work — research, wireframes, UI screens, prototypes and more.</div>
              )}
                </>
              )}
              <div className={job || joiningEntry || hourly ? "fgrid-3" : "fgrid-4"} style={{ marginTop: 18 }}>
                {!job && !joiningEntry && !hourly && (
                <div>
                  <label className="lbl" htmlFor="f-qty">Quantity {rate && <span className="muted">{rate.unit}</span>}</label>
                  <div className="stepper">
                    <button type="button" onClick={() => set({ qty: String(Math.max(0.5, qty - 0.5)) })} aria-label="Decrease quantity"><Icon name="minus" size={14} /></button>
                    <input id="f-qty" ref={qtyRef} type="number" inputMode="decimal" min={0.5} step={0.5} value={form.qty} onChange={(e) => set({ qty: e.target.value })} />
                    <button type="button" onClick={() => set({ qty: String(qty + 0.5) })} aria-label="Increase quantity"><Icon name="plus" size={14} /></button>
                  </div>
                </div>
                )}
                <div>
                  <label className="lbl" htmlFor="f-start">Started at <span className="req">*</span></label>
                  <input id="f-start" ref={startRef} type="time" step={300} value={form.startTime} onChange={(e) => set({ startTime: e.target.value })} />
                  <div className="help">{form.date === today ? "Defaults to now" : "When you started"}</div>
                </div>
                <div>
                  <label className="lbl" htmlFor="f-hours">Time spent <span className="req">*</span></label>
                  <input id="f-hours" ref={hoursRef} type="text" inputMode="decimal" autoComplete="off" placeholder="e.g. 20m, 1h30 or 1.5"
                    value={form.hours} onChange={(e) => set({ hours: e.target.value })} />
                  <div className="help" style={hoursUnreadable ? { color: "var(--bad)" } : undefined}>
                    {hoursUnreadable
                      ? "Try 20m, 1h30, 1:30 or 1.5"
                      : hours > 0
                        ? hourly && rate
                          ? `${hoursLabel(hours)} × ${fmt(rate.rate)} pts per hour — this work is paid by the clock`
                          : `${hoursLabel(hours)} · counts as ${Math.round(hours * 100) / 100} hrs`
                        : "Minutes or hours — 20m, 1h30 or 1.5"}
                  </div>
                  {overDayLimit && (
                    <div className="help" style={{ color: "var(--bad)" }}>
                      {hoursLabel(hoursLoggedToday)} already logged that day — a day holds {MAX_HOURS_PER_DAY} hours.
                    </div>
                  )}
                </div>
                <div>
                  <label className="lbl" id="status-lbl">Status</label>
                  <div className="seg" role="radiogroup" aria-labelledby="status-lbl" style={{ display: "flex" }}>
                    {STATUSES.map((s) => (
                      <button key={s} type="button" role="radio" aria-checked={s === form.status} className={s === form.status ? "on" : ""}
                        style={{ flex: 1, justifyContent: "center", padding: "0 6px" }} onClick={() => set({ status: s })}>{s}</button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="fsec">
              <Step n={3} done={!!form.desc.trim()} title="Details" />
              <div className="fgrid">
                <div className="wide">
                  {quickClaim && typical && rate && (
                    <div className="note" role="status" style={{ marginBottom: 16 }}>
                      <Icon name="alert" size={16} />
                      <div>
                        <b>{rate.type.split(" (")[0]}</b> usually takes about <b>{hoursLabel(typical)}</b>, and you&apos;ve logged {hoursLabel(hours)}.
                        If you assisted someone rather than doing the whole thing, put it on a <b>job card</b> so the points split by time —
                        or pick an hourly work type. You can still save this as it is.
                      </div>
                    </div>
                  )}
                  <label className="lbl" htmlFor="f-desc">Description <span className="req">*</span></label>
                  <textarea id="f-desc" ref={descRef} maxLength={300} value={form.desc} onChange={(e) => set({ desc: e.target.value })}
                    placeholder="e.g. Designed onboarding wireframes for Classory mobile app – 6 screens" />
                  <div className="help">{form.desc.length}/300 · Be specific so reviewers understand the output.</div>
                </div>
                <div className="wide">
                  <label className="lbl" htmlFor="f-client">Client / brand / project</label>
                  <input id="f-client" list="clientlist" autoComplete="off" maxLength={120} value={form.client} onChange={(e) => set({ client: e.target.value })}
                    placeholder="Classory, Kharshi Trendz, Solder Minds…" />
                  <datalist id="clientlist">{clients.map((c) => <option key={c} value={c} />)}</datalist>
                </div>
              </div>
            </section>

            <div className="card-f">
              <span className={`missing${missing.length ? "" : " ready"}`}>
                <Icon name={missing.length ? "alert" : "checkc"} size={14} />
                <span>{missing.length ? `Still needed: ${missing.join(", ")}` : "Ready to save"}</span>
              </span>
              {editing
                ? <button type="button" className="btn sec" onClick={cancelEdit}>Cancel</button>
                : <button type="button" className="btn ghost" onClick={() => setForm((f) => blank(f.memberId, { date: f.date, dept: f.dept }))}>Clear form</button>}
              <button className={`btn lg${saving ? " busy" : ""}`} type="submit" disabled={!!missing.length || saving}>
                <Icon name="check" size={16} />{editing ? "Update entry" : "Save entry"} <kbd>{modKey}↵</kbd>
              </button>
            </div>
          </form>

          {member && (
            <div className="card">
              <div className="card-h">
                <div>
                  <h2>{member.name.split(" ")[0]}’s entries · {dateLabel(form.date, { weekday: "long", day: "numeric", month: "long" })}</h2>
                  <p>{cur.loading ? "Loading…" : dayEntries.length ? `${dayEntries.length} ${dayEntries.length === 1 ? "entry" : "entries"} · ${fmt(sum(dayEntries, pts))} points` : "Nothing logged for this day yet."}</p>
                </div>
              </div>
              {cur.loading ? <SkeletonRows rows={2} /> : dayEntries.length ? (
                <div className="daylist">
                  {dayEntries.map((e) => (
                    <div key={e.id} className={`row${e.id === editing?.id ? " editing" : ""}`}>
                      <div style={{ minWidth: 0 }}>
                        <div className="desc">{e.desc}</div>
                        <div className="meta">
                          <span>{rateById.get(e.typeId)?.type ?? e.typeName}</span>
                          {e.client && <><span>·</span><span>{e.client}</span></>}
                          <StatusPill status={e.status} />
                        </div>
                      </div>
                      <div className="p">{fmt(pts(e))}<small>pts</small></div>
                      <div style={{ display: "flex", gap: 2 }}>
                        <EntryActions entry={e} onDeleted={e.id === editing?.id ? cancelEdit : undefined} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon="clock" title="No entries yet">Entries you save for this day will appear here.</EmptyState>
              )}
            </div>
          )}
        </div>

        <aside className="summary" aria-live="polite">
          <div className="ptscard">
            <div className="lab">{job || joiningEntry ? "Your share so far" : "This entry"}</div>
            <div className="big">{fmt(live)}<small>points</small></div>
            <div className="formula">
              {job || joiningEntry ? (
                <>your <b>{hoursLabel(hours)}</b> of <b>{hoursLabel(hours + otherHours)}</b> on a <b>{fmt(pot)}</b> pt job</>
              ) : hourly && rate ? (
                <><b>{hoursLabel(hours)}</b> × <b>{fmt(rate.rate)}</b> pts per hour</>
              ) : rate ? (
                <><b>{fmt(qty)}</b> × <b>{fmt(rate.rate)}</b> pts {rate.unit}</>
              ) : "Choose a work type to calculate points"}
            </div>
            {(job || joiningEntry) && <div className="formula" style={{ marginTop: 6, opacity: .75 }}>Settles when everyone has logged their time</div>}
            <hr />
            <div className="ministats">
              <div><b>{fmt(dayTotal)}</b>Day total</div>
              <div><b>{fmt(monthTotal)}</b>{monthLabel(ym, true)} total</div>
            </div>
            <hr />
            {member && perf ? (
              <>
                <div className="progrow"><span>Monthly target</span><span><b>{member.target ? Math.round((monthTotal / member.target) * 100) : 0}%</b> of {fmt(member.target)}</span></div>
                <div className="progress" data-tip="White marker = expected progress by today">
                  <i style={{ width: `${member.target ? Math.min(100, (monthTotal / member.target) * 100) : 0}%` }} />
                  {wdT > 0 && <span className="pace" style={{ left: `${(wdE / wdT) * 100}%` }} />}
                </div>
                <div className="formula" style={{ marginTop: 10 }}>
                  {perf.label}
                  {member.target > monthTotal && wdE < wdT ? ` · ${fmt(member.target - monthTotal)} pts to go in ${wdT - wdE} working days` : member.target && monthTotal >= member.target ? " · Target reached 🎉" : ""}
                </div>
              </>
            ) : (
              <div className="formula">Select your name to track progress against your monthly target.</div>
            )}
          </div>
          <div className="card tipcard">
            <h3><Icon name="layers" size={16} />Quick tips</h3>
            <ul>
              <li>One task per entry — split a busy day into several entries.</li>
              <li>Use <b>Log again</b> to repeat recurring work in one click.</li>
              <li>Press <b>{modKey} + Enter</b> to save.</li>
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}
