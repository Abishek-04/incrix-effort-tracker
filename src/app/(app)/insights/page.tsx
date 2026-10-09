"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useData } from "@/components/DataProvider";
import { Icon } from "@/components/Icon";
import { Avatar, EmptyState, PageHead, SkeletonRows } from "@/components/ui";
import { useUI } from "@/components/UIProvider";
import { api } from "@/lib/api";
import {
  RATING_CLASS, currentPeriod, periodLabel, shiftPeriod,
  type Insight, type InsightStats, type PeriodKind, type TeamInsight, type TeamStats,
} from "@/lib/insights";
import { dateLabel, fmt } from "@/lib/utils";

const errMsg = (e: unknown) => (e as Error).message;

export default function InsightsPage() {
  const { team } = useData();
  const { toast, confirm } = useUI();
  const [scope, setScope] = useState<"team" | "person">("team");

  const active = team.filter((m) => m.active);
  const [memberId, setMemberId] = useState("");
  const [kind, setKind] = useState<PeriodKind>("month");
  const [period, setPeriod] = useState(() => currentPeriod("month"));
  const [stats, setStats] = useState<InsightStats | null>(null);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"generate" | "publish" | "save" | null>(null);
  const request = useRef(0);

  const member = team.find((m) => m.id === memberId);
  useEffect(() => { if (!memberId && active.length) setMemberId(active[0].id); }, [active, memberId]);

  const load = useCallback(async () => {
    if (!memberId) return;
    const ticket = ++request.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [s, i] = await Promise.all([api.insightStats(memberId, kind, period), api.insight(memberId, kind, period)]);
      if (ticket !== request.current) return;
      setStats(s.stats);
      setInsight(i.insight);
      setNote(i.insight?.adminNote ?? "");
      setMessage(i.insight?.employeeMessage ?? "");
    } catch (e) {
      if (ticket !== request.current) return;
      setLoadError(errMsg(e));
      setStats(null);
      setInsight(null);
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [memberId, kind, period]);
  useEffect(() => { load(); }, [load]);

  const switchKind = (k: PeriodKind) => { setKind(k); setPeriod(currentPeriod(k)); };

  const generate = async () => {
    if (!member) return;
    if (insight?.published) {
      const ok = await confirm({
        title: "Regenerate this analysis?",
        body: `${member.name} can currently see the shared message for this period. Regenerating replaces it and takes it back to draft until you share it again.`,
        ok: "Regenerate", icon: "refresh",
      });
      if (!ok) return;
    }
    setBusy("generate");
    try {
      const r = await api.generateInsight({ memberId: member.id, kind, period, adminNote: note });
      setInsight(r.insight);
      setMessage(r.insight.employeeMessage);
      toast("Analysis ready — review it before sharing");
    } catch (e) {
      toast(errMsg(e), { error: true });
    } finally {
      setBusy(null);
    }
  };

  const push = async (published: boolean, mode: "publish" | "save") => {
    if (!insight) return;
    setBusy(mode);
    try {
      const r = await api.publishInsight({ memberId: insight.memberId, kind, period, published, employeeMessage: message });
      setInsight(r.insight);
      toast(mode === "save" ? "Message saved" : published ? `Shared with ${insight.memberName}` : "Taken back — the message is hidden again");
    } catch (e) {
      toast(errMsg(e), { error: true });
    } finally {
      setBusy(null);
    }
  };

  const analysis = insight?.analysis;
  const thisPeriod = currentPeriod(kind);

  return (
    <>
      <PageHead
        title="Insights"
        sub={scope === "team"
          ? "How the whole team did this period, read against your own notes. For you only — nothing here is shared with anyone."
          : "Gemini reviews a member's logged work alongside your own recommendations. Nothing reaches the team member until you share it."}
        actions={
          <>
            <div className="seg" role="group" aria-label="Who to review">
              <button className={scope === "team" ? "on" : ""} onClick={() => setScope("team")}>Whole team</button>
              <button className={scope === "person" ? "on" : ""} onClick={() => setScope("person")}>One person</button>
            </div>
            <div className="seg" role="group" aria-label="Period type">
              {(["week", "month"] as const).map((k) => (
                <button key={k} className={kind === k ? "on" : ""} onClick={() => switchKind(k)} aria-pressed={kind === k}>
                  {k === "week" ? "Weekly" : "Monthly"}
                </button>
              ))}
            </div>
            {period !== thisPeriod && <button className="btn ghost sm" onClick={() => setPeriod(thisPeriod)}>This {kind}</button>}
            <div className="monthnav">
              <button onClick={() => setPeriod(shiftPeriod(kind, period, -1))} aria-label={`Previous ${kind}`}><Icon name="chevL" size={16} /></button>
              <span>{periodLabel(kind, period)}</span>
              <button onClick={() => setPeriod(shiftPeriod(kind, period, 1))} aria-label={`Next ${kind}`}><Icon name="chevR" size={16} /></button>
            </div>
          </>
        }
      />

      {scope === "team" ? (
        <TeamReview kind={kind} period={period} />
      ) : !active.length ? (
        <div className="card"><EmptyState icon="users" title="No active team members">Add members in Setup before running an analysis.</EmptyState></div>
      ) : (
        <div className="stack">
          <div className="card">
            <div className="toolbar">
              <div className="who">
                <Avatar name={member?.name ?? "?"} />
                <div style={{ minWidth: 0 }}>
                  <select value={memberId} onChange={(e) => setMemberId(e.target.value)} aria-label="Team member" style={{ minWidth: 220 }}>
                    {active.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {member?.role || "No role recorded"} · {member?.dept} · target {fmt(member?.target ?? 0)} pts / month
              </span>
              <div className="spacer" />
              <StatusChip insight={insight} loading={loading} />
            </div>
          </div>

          {loadError ? (
            <div className="errorbox" role="alert">
              <Icon name="alert" /><div><b>Couldn&apos;t load this period</b>{loadError}</div>
              <button className="btn sec sm" onClick={load}>Try again</button>
            </div>
          ) : loading || !stats ? (
            <div className="card"><SkeletonRows rows={4} /></div>
          ) : (
            <>
              <Figures stats={stats} />

              <div className="ins-cols">
                <div className="card">
                  <div className="card-h">
                    <div>
                      <h2>Your recommendations</h2>
                      <p>What you already know about {member?.name.split(" ")[0]}&apos;s work this {kind} — context the log can&apos;t show. The analysis weighs this heavily.</p>
                    </div>
                  </div>
                  <div className="card-b">
                    <textarea
                      rows={7} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000}
                      placeholder={`e.g. Took over the ${member?.dept === "Content" ? "Solder Minds reels" : "client dashboard"} mid-way when the lead was away. Needs to improve handover notes. Ready for more client-facing work.`}
                      aria-label="Your recommendations for this member"
                    />
                    <div className="help">{note.length}/2000 · Optional, but the analysis is far more useful with it.</div>
                  </div>
                  <div className="card-f">
                    <button className={`btn${busy === "generate" ? " busy" : ""}`} onClick={generate} disabled={!!busy}>
                      <Icon name="spark" size={16} />{insight ? "Regenerate analysis" : "Generate analysis"}
                    </button>
                    {insight && <span className="muted" style={{ fontSize: 12 }}>Last run {dateLabel(insight.generatedAt.slice(0, 10), { day: "numeric", month: "short" })} · {insight.model}</span>}
                  </div>
                </div>

                <Analysis insight={insight} busy={busy === "generate"} />
              </div>

              {insight && analysis && (
                <div className="card">
                  <div className="card-h">
                    <div>
                      <h2>Message to {insight.memberName.split(" ")[0]}</h2>
                      <p>This is the only part {insight.memberName.split(" ")[0]} sees, along with the figures and focus points. Edit it freely before sharing.</p>
                    </div>
                    <StatusChip insight={insight} loading={false} />
                  </div>
                  <div className="card-b">
                    <textarea rows={9} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} aria-label="Message to the team member" />
                    <div className="help">{message.length}/4000 · Written by Gemini from your notes and the log. Your edits are what gets shared.</div>
                  </div>
                  <div className="card-f">
                    {insight.published ? (
                      <>
                        <button className={`btn${busy === "save" ? " busy" : ""}`} onClick={() => push(true, "save")} disabled={!!busy}>
                          <Icon name="check" size={16} />Save changes
                        </button>
                        <button className={`btn danger-sec${busy === "publish" ? " busy" : ""}`} onClick={() => push(false, "publish")} disabled={!!busy}>
                          <Icon name="eyeOff" size={16} />Take back
                        </button>
                      </>
                    ) : (
                      <>
                        <button className={`btn${busy === "publish" ? " busy" : ""}`} onClick={() => push(true, "publish")} disabled={!!busy}>
                          <Icon name="send" size={16} />Share with {insight.memberName.split(" ")[0]}
                        </button>
                        <button className={`btn sec${busy === "save" ? " busy" : ""}`} onClick={() => push(false, "save")} disabled={!!busy}>
                          <Icon name="check" size={16} />Save draft
                        </button>
                      </>
                    )}
                    <div className="spacer" />
                    <span className="muted" style={{ fontSize: 12 }}>
                      {insight.published && insight.publishedAt
                        ? `Shared ${dateLabel(insight.publishedAt.slice(0, 10), { day: "numeric", month: "short", year: "numeric" })}`
                        : "Only you can see this"}
                    </span>
                  </div>
                </div>
              )}

              <History stats={stats} kind={kind} />
            </>
          )}
        </div>
      )}
    </>
  );
}

function StatusChip({ insight, loading }: { insight: Insight | null; loading: boolean }) {
  if (loading) return null;
  if (!insight) return <span className="pill"><Icon name="clock" size={12} />Not analysed yet</span>;
  return insight.published
    ? <span className="pill ok"><Icon name="checkc" size={12} />Shared with {insight.memberName.split(" ")[0]}</span>
    : <span className="pill warn"><Icon name="eyeOff" size={12} />Draft — not shared</span>;
}

export function Figures({ stats }: { stats: InsightStats }) {
  const pct = stats.target ? Math.min(100, (stats.points / stats.target) * 100) : 0;
  const cls = stats.attainment >= 90 ? "ok" : stats.attainment >= 60 ? "warn" : "bad";
  return (
    <div className="kpis">
      <div className="card kpi">
        <div className="k-h"><span className="k-i"><Icon name="trend" size={16} /></span>Points logged</div>
        <div className="k-v">{fmt(stats.points)}<small> / {fmt(stats.target)}</small></div>
        <div className="progress" style={{ marginBottom: 8 }}><i className={cls} style={{ width: `${pct}%` }} /></div>
        <div className="k-f">{Math.round(stats.attainment)}% of the target for this period</div>
      </div>
      <div className="card kpi">
        <div className="k-h"><span className="k-i"><Icon name="file" size={16} /></span>Entries</div>
        <div className="k-v">{stats.entries}</div>
        <div className="k-f">{fmt(stats.avgPointsPerEntry)} pts per entry · {fmt(stats.hours)} hrs recorded</div>
      </div>
      <div className="card kpi">
        <div className="k-h"><span className="k-i"><Icon name="grid" size={16} /></span>Days logged</div>
        <div className="k-v">{stats.daysLogged}<small> / {stats.workingDaysElapsed || stats.workingDays}</small></div>
        <div className="k-f">{stats.longestGap ? `Longest gap ${stats.longestGap} working day${stats.longestGap === 1 ? "" : "s"}` : "Logged every working day"}</div>
        {stats.loggedSameDay !== undefined && stats.entries > 0 && (
          <div className="k-f">{stats.loggedSameDay} of {stats.entries} logged the same day{stats.avgLogDelayDays ? ` · ${fmt(stats.avgLogDelayDays)} days late on average` : ""}</div>
        )}
      </div>
      <div className="card kpi">
        <div className="k-h"><span className="k-i"><Icon name="layers" size={16} /></span>Work mix</div>
        <div className="k-v">{stats.topTypes.length}<small> types</small></div>
        <div className="k-f">
          {stats.statusCounts.Blocked ? `${stats.statusCounts.Blocked} blocked · ` : ""}
          {stats.statusCounts["In Progress"] ? `${stats.statusCounts["In Progress"]} in progress · ` : ""}
          {stats.statusCounts.Done} done
        </div>
      </div>
    </div>
  );
}

function Analysis({ insight, busy }: { insight: Insight | null; busy: boolean }) {
  if (busy) return <div className="card"><SkeletonRows rows={5} /></div>;
  if (!insight) {
    return (
      <div className="card">
        <EmptyState icon="spark" title="No analysis for this period yet">
          Add your recommendations, then generate the analysis. It reads this period&apos;s entries plus the four before it.
        </EmptyState>
      </div>
    );
  }
  const a = insight.analysis;
  return (
    <div className="card">
      <div className="card-h">
        <div>
          <h2>{a.headline}</h2>
          <p>Generated from {insight.stats.entries} entries · reviewed by you before anyone else sees it</p>
        </div>
        <span className={`pill ${RATING_CLASS[a.rating] ?? ""}`}><Icon name="target" size={12} />{a.rating} · {a.score}</span>
      </div>
      <div className="card-b ins-body">
        <p className="ins-summary">{a.summary}</p>

        <Section title="Strengths" icon="checkc" tone="ok">
          {a.strengths.map((s, i) => <li key={i}><b>{s.title}</b><span>{s.evidence}</span></li>)}
        </Section>
        <Section title="Where it slips" icon="alert" tone="warn">
          {a.weaknesses.map((w, i) => <li key={i}><b>{w.title}</b><span>{w.evidence}</span><span className="muted">{w.impact}</span></li>)}
        </Section>
        <Section title="Recommended actions" icon="target">
          {a.recommendations.map((r, i) => (
            <li key={i}>
              <b>{r.action} <span className={`pill ${r.priority === "High" ? "bad" : r.priority === "Medium" ? "warn" : ""}`}>{r.priority}</span></b>
              <span>{r.why}</span>
            </li>
          ))}
        </Section>

        {!!a.focusNext.length && (
          <div>
            <h4 className="ins-h"><Icon name="trend" size={14} />Focus next period</h4>
            <div className="chips">{a.focusNext.map((f, i) => <span key={i} className="chip hint">{f}</span>)}</div>
          </div>
        )}
        {!!a.caveats.length && (
          <div className="note"><Icon name="alert" size={16} /><div>{a.caveats.join(" ")}</div></div>
        )}
      </div>
    </div>
  );
}

function Section({ title, icon, tone, children }: { title: string; icon: "checkc" | "alert" | "target"; tone?: string; children: ReactNode[] }) {
  if (!children.length) return null;
  return (
    <div>
      <h4 className={`ins-h ${tone ?? ""}`}><Icon name={icon} size={14} />{title}</h4>
      <ul className="ins-list">{children}</ul>
    </div>
  );
}

function History({ stats, kind }: { stats: InsightStats; kind: PeriodKind }) {
  const rows = [...stats.history, { key: "now", label: "This " + kind, points: stats.points, target: stats.target, entries: stats.entries }];
  const max = Math.max(1, ...rows.map((r) => Math.max(r.points, r.target)));
  return (
    <div className="card">
      <div className="card-h"><div><h2>Recent {kind}s</h2><p>Points logged against the target for each period, oldest first</p></div></div>
      <div className="card-b">
        <div className="hbars">
          {rows.map((r) => (
            <div key={r.key} className="hbar" data-tip={`${r.label}: ${fmt(r.points)} of ${fmt(r.target)} pts · ${r.entries} entries`}>
              <span>{r.label}</span>
              <span className="track"><i style={{ width: `${(r.points / max) * 100}%` }} /></span>
              <span className="v">{fmt(r.points)}<small>{r.target ? Math.round((r.points / r.target) * 100) : 0}%</small></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- The whole team ---------------- */
function TeamReview({ kind, period }: { kind: PeriodKind; period: string }) {
  const { toast } = useUI();
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [insight, setInsight] = useState<TeamInsight | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const r = await api.teamInsight(kind, period);
      if (ticket !== request.current) return;
      setStats(r.stats);
      setInsight(r.insight);
      setNote(r.insight?.adminNote ?? "");
    } catch (e) {
      if (ticket === request.current) { setError(errMsg(e)); setStats(null); setInsight(null); }
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [kind, period]);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.generateTeamInsight({ kind, period, adminNote: note });
      setInsight(r.insight);
      toast("Team review ready");
    } catch (e) {
      toast(errMsg(e), { error: true });
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="errorbox" role="alert">
        <Icon name="alert" /><div><b>Couldn&apos;t load the team&apos;s figures</b>{error}</div>
        <button className="btn sec sm" onClick={load}>Try again</button>
      </div>
    );
  }
  if (loading || !stats) return <div className="card"><SkeletonRows rows={5} /></div>;

  const a = insight?.analysis;
  const pct = stats.target ? Math.min(100, (stats.points / stats.target) * 100) : 0;
  const cls = stats.attainment >= 90 ? "ok" : stats.attainment >= 60 ? "warn" : "bad";
  const idle = stats.perMember.filter((m) => !m.entries);
  const d = stats.discipline;

  return (
    <div className="stack">
      <div className="kpis">
        <div className="card kpi">
          <div className="k-h"><span className="k-i"><Icon name="trend" size={16} /></span>Team points</div>
          <div className="k-v">{fmt(stats.points)}<small> / {fmt(stats.target)}</small></div>
          <div className="progress" style={{ marginBottom: 8 }}><i className={cls} style={{ width: `${pct}%` }} /></div>
          <div className="k-f">{Math.round(stats.attainment)}% of the combined target</div>
        </div>
        <div className="card kpi">
          <div className="k-h"><span className="k-i"><Icon name="users" size={16} /></span>Logging</div>
          <div className="k-v">{stats.contributors}<small> / {stats.activeMembers}</small></div>
          <div className="k-f">{idle.length ? `${idle.length} logged nothing: ${idle.slice(0, 3).map((m) => m.name.split(" ")[0]).join(", ")}${idle.length > 3 ? "…" : ""}` : "Everyone logged something"}</div>
        </div>
        <div className="card kpi">
          <div className="k-h"><span className="k-i"><Icon name="file" size={16} /></span>Output</div>
          <div className="k-v">{stats.entries}<small> entries</small></div>
          <div className="k-f">{fmt(stats.hours)} hrs · {d.loggedSameDay} of {stats.entries} logged same day</div>
        </div>
        <div className="card kpi">
          <div className="k-h"><span className="k-i"><Icon name="layers" size={16} /></span>Shared work</div>
          <div className="k-v">{stats.collaboration.cards}<small> cards</small></div>
          <div className="k-f">
            {stats.collaboration.cards ? `${fmt(stats.collaboration.sharedPoints)} pts across ${stats.collaboration.peopleOnCards} people` : "No work shared this period"}
            {d.possibleDuplicates ? ` · ${d.possibleDuplicates} look logged twice` : ""}
          </div>
        </div>
      </div>

      <div className="ins-cols">
        <div className="card">
          <div className="card-h"><div><h2>Your read on the period</h2><p>What you know that the log doesn&apos;t show — pressures, absences, client trouble. Weighed above everything else.</p></div></div>
          <div className="card-b">
            <textarea rows={7} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000}
              placeholder="e.g. Two people were on the Axicarb shoot all week. Classory launch slipped, so Software lost three days waiting on the client." />
            <div className="help">{note.length}/2000</div>
          </div>
          <div className="card-f">
            <button className={`btn${busy ? " busy" : ""}`} onClick={generate} disabled={busy}>
              <Icon name="spark" size={16} />{insight ? "Regenerate team review" : "Generate team review"}
            </button>
            {insight && <span className="muted" style={{ fontSize: 12 }}>Last run {dateLabel(insight.generatedAt.slice(0, 10), { day: "numeric", month: "short" })} · {insight.model}</span>}
          </div>
        </div>

        {busy ? <div className="card"><SkeletonRows rows={5} /></div> : a ? (
          <div className="card">
            <div className="card-h">
              <div><h2>{a.headline}</h2><p>{stats.entries} entries from {stats.contributors} people</p></div>
              <span className={`pill ${RATING_CLASS[a.rating] ?? ""}`}><Icon name="target" size={12} />{a.rating} · {a.score}</span>
            </div>
            <div className="card-b ins-body">
              <p className="ins-summary">{a.summary}</p>
              <Section title="Working well" icon="checkc" tone="ok">
                {a.strengths.map((x, i) => <li key={i}><b>{x.title}</b><span>{x.evidence}</span></li>)}
              </Section>
              <Section title="Risks" icon="alert" tone="warn">
                {a.risks.map((x, i) => <li key={i}><b>{x.title}</b><span>{x.evidence}</span><span className="muted">{x.impact}</span></li>)}
              </Section>
              <Section title="What to do" icon="target">
                {a.recommendations.map((r, i) => (
                  <li key={i}>
                    <b>{r.action} <span className={`pill ${r.priority === "High" ? "bad" : r.priority === "Medium" ? "warn" : ""}`}>{r.priority}</span></b>
                    <span>{r.why}</span>
                  </li>
                ))}
              </Section>
              {!!a.people.length && (
                <Section title="People worth a word" icon="checkc">
                  {a.people.map((p, i) => <li key={i}><b>{p.name}</b><span>{p.note}</span></li>)}
                </Section>
              )}
              {!!a.focusNext.length && (
                <div>
                  <h4 className="ins-h"><Icon name="trend" size={14} />Focus next {kind}</h4>
                  <div className="chips">{a.focusNext.map((f, i) => <span key={i} className="chip hint">{f}</span>)}</div>
                </div>
              )}
              {!!a.caveats.length && <div className="note"><Icon name="alert" size={16} /><div>{a.caveats.join(" ")}</div></div>}
            </div>
          </div>
        ) : (
          <div className="card">
            <EmptyState icon="spark" title="No team review for this period yet">
              Add your read on the period, then generate. It looks at every active member, the department mix, shared work and logging habits.
            </EmptyState>
          </div>
        )}
      </div>

      <div className="cols-2">
        <div className="card">
          <div className="card-h"><div><h2>Who produced what</h2><p>Points against each person&apos;s target for this {kind}</p></div></div>
          <div className="tablewrap">
            <table className="t">
              <thead><tr><th>Member</th><th>Points</th><th className="num">Attainment</th><th className="num">Entries</th><th className="num">Hours</th></tr></thead>
              <tbody>
                {stats.perMember.map((m) => (
                  <tr key={m.id}>
                    <td><div className="who"><Avatar name={m.name} sm /><div style={{ minWidth: 0 }}><b>{m.name}</b><small>{m.dept}</small></div></div></td>
                    <td>
                      <div className="perfbar">
                        <div className="progress"><i className={m.attainment >= 90 ? "ok" : m.attainment >= 60 ? "warn" : "bad"} style={{ width: `${Math.min(100, m.attainment)}%` }} /></div>
                        <span><b>{fmt(m.points)}</b> <span className="muted">/ {fmt(m.target)}</span></span>
                      </div>
                    </td>
                    <td className="num"><b>{Math.round(m.attainment)}%</b></td>
                    <td className="num muted">{m.entries}</td>
                    <td className="num muted">{fmt(m.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><div><h2>Where the points came from</h2><p>Departments, then the work types inside them</p></div></div>
          <div className="card-b">
            <div className="hbars">
              {stats.perDept.map((x) => (
                <div key={x.dept} className="hbar" data-tip={`${x.dept}: ${fmt(x.points)} pts · ${x.entries} entries`}>
                  <span>{x.dept}</span>
                  <span className="track"><i style={{ width: `${stats.perDept[0].points ? (x.points / stats.perDept[0].points) * 100 : 0}%` }} /></span>
                  <span className="v">{fmt(x.points)}<small>{x.share}%</small></span>
                </div>
              ))}
            </div>
            <h4 className="ins-h" style={{ marginTop: 18 }}><Icon name="layers" size={14} />Most of the work</h4>
            <ul className="ins-list">
              {stats.topTypes.slice(0, 6).map((t) => (
                <li key={t.type}><b>{t.type}</b><span>{fmt(t.points)} pts · {fmt(t.count)} logged</span></li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <History stats={{ ...stats, history: stats.history } as unknown as InsightStats} kind={kind} />
    </div>
  );
}
