"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Icon } from "@/components/Icon";
import { EmptyState, PageHead, SkeletonRows } from "@/components/ui";
import { api } from "@/lib/api";
import { RATING_CLASS, periodLabel, type Insight } from "@/lib/insights";
import { dateLabel, fmt } from "@/lib/utils";

/** What a team member sees: only the reviews their administrator has shared. */
export default function MyInsightsPage() {
  const { user } = useAuth();
  const [list, setList] = useState<Insight[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only a personal login has insights of its own; the admin reviews everyone's under Insights.
  const memberId = user.memberId ?? "";

  const load = useCallback(() => {
    if (!memberId) return;
    setError(null);
    api.insightHistory(memberId).then((r) => { setList(r.insights); setOpenKey(r.insights[0] ? keyOf(r.insights[0]) : null); }).catch((e) => setError((e as Error).message));
  }, [memberId]);
  useEffect(() => { load(); }, [load]);

  const open = list?.find((i) => keyOf(i) === openKey) ?? null;

  return (
    <>
      <PageHead title="My insights" sub="Reviews of your logged work, shared with you by your administrator." />
      {!memberId ? (
        <div className="card">
          <EmptyState icon="user" title="This page is for personal logins">
            Sign in with a personal team login to see the insights shared with you. As an administrator, review and share everyone&apos;s under Insights.
          </EmptyState>
        </div>
      ) : error ? (
        <div className="errorbox" role="alert">
          <Icon name="alert" /><div><b>Couldn&apos;t load your insights</b>{error}</div>
          <button className="btn sec sm" onClick={load}>Try again</button>
        </div>
      ) : !list ? (
        <div className="card"><SkeletonRows rows={3} /></div>
      ) : !list.length ? (
        <div className="card">
          <EmptyState icon="spark" title="Nothing shared yet">
            When your work for a week or month has been reviewed, it appears here. Keep logging your work so the review reflects what you actually did.
          </EmptyState>
        </div>
      ) : (
        <div className="stack">
          {list.length > 1 && (
            <div className="chips">
              {list.map((i) => (
                <button key={keyOf(i)} className={`chip${keyOf(i) === openKey ? " on" : ""}`} onClick={() => setOpenKey(keyOf(i))}>
                  {periodLabel(i.kind, i.period)}<small>{i.kind === "week" ? "Week" : "Month"}</small>
                </button>
              ))}
            </div>
          )}
          {open && <Review insight={open} />}
        </div>
      )}
    </>
  );
}

const keyOf = (i: Insight) => `${i.kind}#${i.period}`;

function Review({ insight }: { insight: Insight }) {
  const a = insight.analysis;
  const s = insight.stats;
  const pct = s.target ? Math.min(100, (s.points / s.target) * 100) : 0;
  const cls = s.attainment >= 90 ? "ok" : s.attainment >= 60 ? "warn" : "bad";

  return (
    <>
      <div className="card">
        <div className="card-h">
          <div>
            <h2>{a.headline}</h2>
            <p>{periodLabel(insight.kind, insight.period)} · shared {insight.publishedAt ? dateLabel(insight.publishedAt.slice(0, 10), { day: "numeric", month: "short", year: "numeric" }) : ""}</p>
          </div>
          <span className={`pill ${RATING_CLASS[a.rating] ?? ""}`}><Icon name="target" size={12} />{a.rating}</span>
        </div>
        <div className="card-b ins-body">
          <p className="ins-message">{insight.employeeMessage}</p>
        </div>
      </div>

      <div className="kpis">
        <div className="card kpi">
          <div className="k-h"><span className="k-i"><Icon name="trend" size={16} /></span>Your points</div>
          <div className="k-v">{fmt(s.points)}<small> / {fmt(s.target)}</small></div>
          <div className="progress" style={{ marginBottom: 8 }}><i className={cls} style={{ width: `${pct}%` }} /></div>
          <div className="k-f">{Math.round(s.attainment)}% of your target for this {insight.kind}</div>
        </div>
        <div className="card kpi">
          <div className="k-h"><span className="k-i"><Icon name="file" size={16} /></span>Work logged</div>
          <div className="k-v">{s.entries}<small> entries</small></div>
          <div className="k-f">{s.daysLogged} days · {fmt(s.hours)} hrs recorded</div>
        </div>
        <div className="card kpi">
          <div className="k-h"><span className="k-i"><Icon name="layers" size={16} /></span>Most of your points</div>
          <div className="k-v" style={{ fontSize: 17, lineHeight: 1.35 }}>{s.topTypes[0]?.type ?? "—"}</div>
          <div className="k-f">{s.topTypes[0] ? `${fmt(s.topTypes[0].points)} pts from ${s.topTypes[0].count} logged` : "No work logged this period"}</div>
        </div>
      </div>

      <div className="cols-2">
        <div className="card">
          <div className="card-h"><div><h2>What went well</h2></div></div>
          <div className="card-b ins-body">
            <ul className="ins-list">
              {a.strengths.map((x, i) => <li key={i}><b>{x.title}</b><span>{x.evidence}</span></li>)}
            </ul>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><div><h2>Where to improve</h2></div></div>
          <div className="card-b ins-body">
            <ul className="ins-list">
              {a.weaknesses.map((x, i) => <li key={i}><b>{x.title}</b><span>{x.evidence}</span></li>)}
            </ul>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><div><h2>Your next steps</h2><p>Agreed actions and what to focus on in the coming {insight.kind}</p></div></div>
        <div className="card-b ins-body">
          <ul className="ins-list">
            {a.recommendations.map((r, i) => (
              <li key={i}>
                <b>{r.action} <span className={`pill ${r.priority === "High" ? "bad" : r.priority === "Medium" ? "warn" : ""}`}>{r.priority}</span></b>
                <span>{r.why}</span>
              </li>
            ))}
          </ul>
          {!!a.focusNext.length && <div className="chips" style={{ marginTop: 14 }}>{a.focusNext.map((f, i) => <span key={i} className="chip hint">{f}</span>)}</div>}
        </div>
      </div>
    </>
  );
}
