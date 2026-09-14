"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Icon, type IconName } from "@/components/Icon";
import { Avatar, EmptyState, PageHead, SkeletonRows } from "@/components/ui";
import { useUI } from "@/components/UIProvider";
import { api } from "@/lib/api";
import type { Role } from "@/lib/session";
import { DEPTS, ENGINEERING, UIUX, type AccountInfo, type Dept, type Member, type Rate } from "@/lib/types";
import { fileDownload, fmt, todayISO, uniqueName } from "@/lib/utils";

type Tab = "team" | "rates" | "data" | "access";
const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur(); };
const errMsg = (e: unknown) => (e as Error).message;
const focusField = (selector: string) =>
  setTimeout(() => {
    const el = document.querySelector<HTMLInputElement>(selector);
    el?.scrollIntoView({ block: "center" });
    el?.focus();
    el?.select();
  }, 60);

export default function SetupPage() {
  const { team, rates } = useData();
  const [tab, setTab] = useState<Tab>("team");
  const tabs: { k: Tab; label: string; icon: IconName; count?: number }[] = [
    { k: "team", label: "Team members", icon: "users", count: team.length },
    { k: "rates", label: "Point rates", icon: "target", count: rates.length },
    { k: "data", label: "Data & backup", icon: "db" },
    { k: "access", label: "Access & security", icon: "shield" },
  ];
  return (
    <>
      <PageHead title="Setup" sub="Manage team members, monthly targets and point rates. Changes save to the database automatically and apply across all months." />
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.k} role="tab" aria-selected={tab === t.k} className={tab === t.k ? "on" : ""} onClick={() => setTab(t.k)}>
            <Icon name={t.icon} size={16} />{t.label}{t.count !== undefined && <span className="pill">{t.count}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tab === "team" ? <TeamTab /> : tab === "rates" ? <RatesTab /> : tab === "data" ? <DataTab /> : <AccessTab />}</div>
    </>
  );
}

/* ---------------- Team ---------------- */
function TeamTab() {
  const { team, addMember, patchMember, removeMember } = useData();
  const { toast, confirm } = useUI();
  const [q, setQ] = useState("");
  const list = team.filter((m) => !q || `${m.name} ${m.role} ${m.dept}`.toLowerCase().includes(q.toLowerCase()));
  const active = team.filter((m) => m.active);

  const save = async (m: Member, patch: Partial<Member>, el?: HTMLInputElement, revert?: string) => {
    try {
      await patchMember(m.id, patch);
    } catch (e) {
      if (el && revert !== undefined) el.value = revert;
      toast(errMsg(e), { error: true });
    }
  };
  const commitText = (m: Member, key: "name" | "role", el: HTMLInputElement) => {
    const v = el.value.trim();
    if (v === m[key]) return;
    if (key === "name" && !v) { el.value = m.name; return toast("Name can't be empty", { error: true }); }
    save(m, { [key]: v }, el, m[key]);
  };
  const commitTarget = (m: Member, el: HTMLInputElement) => {
    const v = Number(el.value);
    if (el.value === "" || !(v >= 0)) { el.value = String(m.target); return toast("Target must be 0 or more", { error: true }); }
    if (v !== m.target) save(m, { target: v }, el, String(m.target));
  };
  const add = async () => {
    setQ("");
    try {
      const m = await addMember({ name: uniqueName("New member", team.map((t) => t.name)), role: "", dept: "Common", target: 160, active: true });
      focusField(`[data-member-name="${m.id}"]`);
    } catch (e) { toast(errMsg(e), { error: true }); }
  };
  const remove = async (m: Member) => {
    const ok = await confirm({
      title: `Remove ${m.name}?`,
      body: "They'll be removed from the team list, dashboard and grid. Their logged entries stay in the records. Tip: mark them inactive instead to keep them in history.",
      ok: "Remove member", icon: "trash",
    });
    if (!ok) return;
    try {
      await removeMember(m);
      toast(`${m.name} removed`, {
        label: "Undo",
        action: async () => { try { await addMember(m); toast(`${m.name} restored`); } catch (e) { toast(errMsg(e), { error: true }); } },
      });
    } catch (e) { toast(errMsg(e), { error: true }); }
  };

  return (
    <div className="card">
      <div className="toolbar">
        <div className="search"><Icon name="search" size={16} /><input type="search" placeholder="Search members…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search members" /></div>
        <span className="muted" style={{ fontSize: 12.5 }}>{active.length} active · {team.length - active.length} inactive · team target {fmt(active.reduce((a, m) => a + m.target, 0))} pts / month</span>
        <div className="spacer" />
        <button className="btn" onClick={add}><Icon name="plus" size={16} />Add member</button>
      </div>
      {list.length ? (
        <div className="tablewrap">
          <table className="t setup">
            <thead><tr><th>Name</th><th>Role</th><th>Primary department</th><th className="num">Monthly target</th><th>Active</th><th className="act"><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} style={{ opacity: m.active ? 1 : 0.6 }}>
                  <td><div className="namecell"><Avatar name={m.name} sm /><input key={m.name} data-member-name={m.id} defaultValue={m.name} aria-label="Name" onBlur={(e) => commitText(m, "name", e.currentTarget)} onKeyDown={blurOnEnter} /></div></td>
                  <td style={{ minWidth: 240 }}><input key={m.role} defaultValue={m.role} placeholder="Role / responsibilities" aria-label="Role" onBlur={(e) => commitText(m, "role", e.currentTarget)} onKeyDown={blurOnEnter} /></td>
                  <td style={{ minWidth: 160 }}>
                    <select value={m.dept} onChange={(e) => save(m, { dept: e.target.value as Dept })} aria-label="Department">
                      {DEPTS.map((d) => <option key={d}>{d}</option>)}
                    </select>
                  </td>
                  <td className="num"><input key={m.target} type="number" min={0} step={10} defaultValue={m.target} aria-label="Monthly target" onBlur={(e) => commitTarget(m, e.currentTarget)} onKeyDown={blurOnEnter} /></td>
                  <td>
                    <label className="switch" data-tip={m.active ? "Active" : "Inactive"}>
                      <input type="checkbox" checked={m.active} onChange={(e) => save(m, { active: e.target.checked })} aria-label="Active" /><span />
                    </label>
                  </td>
                  <td className="act"><button className="iconbtn del" onClick={() => remove(m)} data-tip="Remove member" aria-label={`Remove ${m.name}`}><Icon name="trash" size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon="users" title="No members found">Try a different search term.</EmptyState>
      )}
    </div>
  );
}

/* ---------------- Rates ---------------- */
function RatesTab() {
  const { rates, addRate, patchRate, removeRate } = useData();
  const { toast, confirm } = useUI();
  const [dept, setDept] = useState<Dept>("Software");
  const items = rates.filter((r) => r.dept === dept);
  const groups = [...new Set(items.map((r) => r.group))];
  if (dept === "Software") [ENGINEERING, UIUX].forEach((g) => { if (!groups.includes(g)) groups.push(g); });
  const multi = groups.length > 1, cols = multi ? 5 : 4;

  const save = async (r: Rate, patch: Partial<Rate>, el?: HTMLInputElement, revert?: string) => {
    try { await patchRate(r.id, patch); } catch (e) { if (el && revert !== undefined) el.value = revert; toast(errMsg(e), { error: true }); }
  };
  const commitText = (r: Rate, key: "type" | "unit", el: HTMLInputElement) => {
    const v = el.value.trim();
    if (v === r[key]) return;
    if (key === "type" && !v) { el.value = r.type; return toast("Work type can't be empty", { error: true }); }
    save(r, { [key]: v }, el, r[key]);
  };
  const commitRate = (r: Rate, el: HTMLInputElement) => {
    const v = Number(el.value);
    if (el.value === "" || !(v >= 0)) { el.value = String(r.rate); return toast("Points must be 0 or more", { error: true }); }
    if (v !== r.rate) save(r, { rate: v }, el, String(r.rate));
  };
  const add = async (group: string) => {
    try {
      const r = await addRate({ dept, type: uniqueName("New work type", rates.map((x) => x.type)), unit: "per item", rate: 1, group });
      focusField(`[data-rate-type="${r.id}"]`);
    } catch (e) { toast(errMsg(e), { error: true }); }
  };
  const remove = async (r: Rate) => {
    const ok = await confirm({ title: "Remove this work type?", body: `“${r.type}” will be removed from the rate card. Existing entries that use it will show 0 points.`, ok: "Remove work type", icon: "trash" });
    if (!ok) return;
    try {
      await removeRate(r);
      toast("Work type removed", {
        label: "Undo",
        action: async () => { try { await addRate(r); toast("Work type restored"); } catch (e) { toast(errMsg(e), { error: true }); } },
      });
    } catch (e) { toast(errMsg(e), { error: true }); }
  };

  return (
    <div className="rate-layout">
      <div className="card deptlist" role="tablist" aria-label="Departments">
        {DEPTS.map((d) => (
          <button key={d} role="tab" aria-selected={d === dept} className={d === dept ? "on" : ""} onClick={() => setDept(d)}>
            {d}<small>{rates.filter((r) => r.dept === d).length}</small>
          </button>
        ))}
      </div>
      <div className="card">
        <div className="card-h">
          <div>
            <h2>{dept} rate card</h2>
            <p>{items.length} work types{multi ? ` in ${groups.length} groups — ${groups.map((g) => g || "General").join(" & ")}` : ""}. Renaming a work type updates it everywhere.</p>
          </div>
        </div>
        <div className="tablewrap">
          <table className="t setup">
            <thead><tr><th>Work type</th><th>Unit</th><th className="num">Points</th>{multi && <th>Group</th>}<th className="act"><span className="sr">Actions</span></th></tr></thead>
            {groups.map((g) => {
              const inGroup = items.filter((r) => r.group === g);
              return (
                <tbody key={g || "general"}>
                  {multi && (
                    <tr className="grouprow">
                      <td colSpan={cols}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <Icon name={g === UIUX ? "layers" : "setup"} size={14} />{g || "General"}<span className="pill">{inGroup.length}</span>
                        </span>
                      </td>
                    </tr>
                  )}
                  {inGroup.map((r) => (
                    <tr key={r.id}>
                      <td style={{ minWidth: 260 }}><input key={r.type} data-rate-type={r.id} defaultValue={r.type} aria-label="Work type" onBlur={(e) => commitText(r, "type", e.currentTarget)} onKeyDown={blurOnEnter} /></td>
                      <td style={{ minWidth: 140 }}><input key={r.unit} defaultValue={r.unit} aria-label="Unit" onBlur={(e) => commitText(r, "unit", e.currentTarget)} onKeyDown={blurOnEnter} /></td>
                      <td className="num"><input key={r.rate} type="number" min={0} step={0.5} defaultValue={r.rate} aria-label="Points" onBlur={(e) => commitRate(r, e.currentTarget)} onKeyDown={blurOnEnter} /></td>
                      {multi && (
                        <td style={{ minWidth: 160 }}>
                          <select value={r.group} onChange={(e) => save(r, { group: e.target.value })} aria-label="Group">
                            {groups.map((x) => <option key={x} value={x}>{x || "General"}</option>)}
                          </select>
                        </td>
                      )}
                      <td className="act"><button className="iconbtn del" onClick={() => remove(r)} data-tip="Remove work type" aria-label={`Remove ${r.type}`}><Icon name="trash" size={16} /></button></td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={cols} style={{ padding: "8px 16px" }}>
                      <button className="btn ghost sm" onClick={() => add(g)}><Icon name="plus" size={14} />Add {multi ? `${g || "General"} ` : ""}work type</button>
                    </td>
                  </tr>
                </tbody>
              );
            })}
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Data ---------------- */
function DataTab() {
  const { team, rates, restoreBackup, resetAll } = useData();
  const { toast, confirm } = useUI();
  const [busy, setBusy] = useState<"backup" | "restore" | "reset" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const download = async () => {
    setBusy("backup");
    try {
      const data = await api.backup();
      fileDownload(`incrix-tracker-backup-${todayISO()}.json`, JSON.stringify(data, null, 1), "application/json");
      toast("Backup downloaded");
    } catch (e) { toast(errMsg(e), { error: true }); } finally { setBusy(null); }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let data: { team?: unknown[]; entries?: unknown[] };
    try { data = JSON.parse(await file.text()); } catch { return toast("That file isn't valid JSON", { error: true }); }
    if (!Array.isArray(data?.team) || !Array.isArray(data?.entries)) return toast("That file isn't a tracker backup", { error: true });
    const ok = await confirm({
      title: "Restore this backup?",
      body: `This replaces ALL data in the database with ${data.entries.length} entries and ${data.team.length} members from “${file.name}”. Download a backup of the current data first if you might need it.`,
      ok: "Restore backup", icon: "upload",
    });
    if (!ok) return;
    setBusy("restore");
    try {
      const r = await restoreBackup(data);
      toast(`Restored ${r.entries} entries, ${r.team} members and ${r.rates} work types`);
    } catch (err) { toast(errMsg(err), { error: true }); } finally { setBusy(null); }
  };

  const reset = async () => {
    const ok = await confirm({
      title: "Reset all data?",
      body: "Every entry in the database will be permanently deleted and the default team and point rates restored. Download a backup first if you might need this data.",
      ok: "Reset everything", icon: "trash",
    });
    if (!ok) return;
    setBusy("reset");
    try { await resetAll(); toast("All data has been reset"); } catch (e) { toast(errMsg(e), { error: true }); } finally { setBusy(null); }
  };

  return (
    <div className="datacards">
      <div className="card datacard">
        <h3><Icon name="download" size={18} />Download backup</h3>
        <p>Export all entries, team members and point rates as a JSON file. Keep a copy before making big changes.</p>
        <div><button className={`btn sec${busy === "backup" ? " busy" : ""}`} disabled={!!busy} onClick={download}><Icon name="download" size={16} />Download JSON</button></div>
      </div>
      <div className="card datacard">
        <h3><Icon name="upload" size={18} />Restore from backup</h3>
        <p>Replace the database with a backup file. Works with backups from this app <b>and</b> from the original HTML tracker (its sample entries are skipped).</p>
        <div>
          <button className={`btn sec${busy === "restore" ? " busy" : ""}`} disabled={!!busy} onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} />Choose backup file…</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} />
        </div>
      </div>
      <div className="card datacard">
        <h3><Icon name="db" size={18} />Storage · AWS DynamoDB</h3>
        <p>Data is stored in a DynamoDB table with point-in-time recovery, so everyone on the team sees the same records.</p>
        <div className="meta">{team.length} members · {rates.length} work types</div>
      </div>
      <div className="card datacard dz">
        <h3><Icon name="warn" size={18} />Reset everything</h3>
        <p>Permanently delete all entries and restore the default team and point rates. This can&apos;t be undone.</p>
        <div><button className={`btn danger-sec${busy === "reset" ? " busy" : ""}`} disabled={!!busy} onClick={reset}><Icon name="trash" size={16} />Reset all data</button></div>
      </div>
    </div>
  );
}

/* ---------------- Access & security ---------------- */
const ACCOUNT_META: Record<Role, { title: string; icon: IconName; desc: string }> = {
  admin: { title: "Administrator login", icon: "shield", desc: "Full access, including Setup, backups and these security settings." },
  team: { title: "Team login", icon: "users", desc: "Shared by the team to log work and view the dashboard, daily grid and entries. Can't open Setup." },
};

function scorePassword(pw: string) {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[a-zA-Z]/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  const levels = [
    ["Too weak", "var(--bad)"], ["Weak", "var(--bad)"], ["Fair", "var(--warn)"],
    ["Good", "var(--ok)"], ["Strong", "var(--ok)"], ["Very strong", "var(--ok)"],
  ] as const;
  return { score, label: levels[score][0], color: levels[score][1] };
}

function AccessTab() {
  const [accounts, setAccounts] = useState<AccountInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api.accounts().then((r) => setAccounts(r.accounts)).catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="errorbox" role="alert">
        <Icon name="alert" /><div><b>Couldn&apos;t load login settings</b>{error}</div>
        <button className="btn sec sm" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!accounts) return <div className="card"><SkeletonRows rows={3} /></div>;

  return (
    <div className="stack">
      <div className="acctcards">
        {(["admin", "team"] as const).map((role) => (
          <AccountCard key={role} role={role} account={accounts.find((a) => a.role === role)} onSaved={setAccounts} />
        ))}
      </div>
      <div className="card tipcard" style={{ padding: "18px 22px" }}>
        <h3><Icon name="lock" size={16} />How sign-in is protected</h3>
        <ul>
          <li>Sessions are signed JWT tokens kept in a secure, HTTP-only cookie that page scripts can&apos;t read.</li>
          <li>A sign-in lasts 12 hours, or 30 days when “Keep me signed in” is ticked.</li>
          <li>Changing a login&apos;s email or password signs out every device using it.</li>
          <li>After 8 wrong passwords in 15 minutes, sign-in for that email pauses for 15 minutes.</li>
          <li>Passwords are stored as salted scrypt hashes, so nobody (administrators included) can see them.</li>
        </ul>
      </div>
    </div>
  );
}

function AccountCard({ role, account, onSaved }: { role: Role; account?: AccountInfo; onSaved: (a: AccountInfo[]) => void }) {
  const { user } = useAuth();
  const { toast, confirm } = useUI();
  const meta = ACCOUNT_META[role];
  const own = user.role === role;
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(account?.email ?? "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [current, setCurrent] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strength = scorePassword(pw);

  const close = () => {
    setEditing(false); setEmail(account?.email ?? ""); setPw(""); setPw2(""); setCurrent(""); setShow(false); setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const newEmail = email.trim().toLowerCase();
    const emailChanged = !!account && newEmail !== account.email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return setError("Enter a valid email address");
    if (!emailChanged && !pw) return setError("Change the email or enter a new password");
    if (pw) {
      if (pw.length < 10) return setError("New password must be at least 10 characters");
      if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return setError("New password must include letters and numbers");
      if (pw !== pw2) return setError("The new passwords don't match");
    }
    if (!current) return setError("Enter your administrator password to confirm");
    setBusy(true);
    setError(null);
    try {
      const r = await api.updateAccount({ role, email: emailChanged ? newEmail : undefined, newPassword: pw || undefined, currentPassword: current });
      onSaved(r.accounts);
      toast(own ? "Your login was updated — other devices were signed out" : `${meta.title} updated — devices using it were signed out`);
      setEditing(false); setPw(""); setPw2(""); setCurrent(""); setShow(false);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    const ok = await confirm({
      title: "Sign out all devices?",
      body: own
        ? "Every other device signed in with the administrator login will be signed out. You'll stay signed in here."
        : "Everyone signed in with the team login will be signed out and must sign in again.",
      ok: "Sign out devices", icon: "logout",
    });
    if (!ok) return;
    try {
      await api.revokeSessions(role);
      toast(own ? "Other administrator devices signed out" : "All team devices signed out");
    } catch (e) {
      toast(errMsg(e), { error: true });
    }
  };

  const updated = account
    ? new Date(account.updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="card">
      <div className="card-h">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span className="kpi"><span className="k-i" style={{ width: 36, height: 36 }}><Icon name={meta.icon} size={18} /></span></span>
          <div>
            <h2>{meta.title}{own && <span className="pill brand" style={{ marginLeft: 8, verticalAlign: 2 }}>You</span>}</h2>
            <p>{meta.desc}</p>
          </div>
        </div>
      </div>

      {!editing ? (
        <>
          <div className="card-b" style={{ display: "grid", gap: 10 }}>
            <div className="who"><Icon name="mail" size={16} /><b style={{ fontWeight: 500 }}>{account?.email ?? "Not set up"}</b></div>
            <div className="meta" style={{ margin: 0 }}><Icon name="clock" size={13} />{updated ? `Last changed ${updated}` : "Create it with: npm run auth:set"}</div>
          </div>
          <div className="card-f">
            <button className="btn sec" onClick={() => setEditing(true)} disabled={!account}><Icon name="key" size={16} />Change email or password</button>
            <button className="btn ghost" onClick={revoke} disabled={!account}><Icon name="logout" size={16} />Sign out all devices</button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="card-b" style={{ display: "grid", gap: 16 }}>
            <div>
              <label className="lbl" htmlFor={`${role}-email`}>Email</label>
              <input id={`${role}-email`} type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="lbl" htmlFor={`${role}-pw`}>New password <span className="muted">leave blank to keep the current one</span></label>
              <div className="pwwrap">
                <input id={`${role}-pw`} type={show ? "text" : "password"} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
                <button type="button" className="iconbtn" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide passwords" : "Show passwords"} aria-pressed={show}>
                  <Icon name={show ? "eyeOff" : "eye"} size={16} />
                </button>
              </div>
              {pw && (
                <>
                  <div className="strength"><i style={{ width: `${(strength.score / 5) * 100}%`, background: strength.color }} /></div>
                  <div className="help">{strength.label} · at least 10 characters with letters and numbers</div>
                </>
              )}
            </div>
            {pw && (
              <div>
                <label className="lbl" htmlFor={`${role}-pw2`}>Confirm new password</label>
                <input id={`${role}-pw2`} type={show ? "text" : "password"} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
              </div>
            )}
            <div style={{ borderTop: "1px solid var(--line-2)", paddingTop: 16 }}>
              <label className="lbl" htmlFor={`${role}-current`}>Your administrator password <span className="req">*</span></label>
              <input id={`${role}-current`} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              <div className="help">Required to confirm security changes.</div>
            </div>
            {error && <div className="auth-alert err" role="alert"><Icon name="alert" size={16} />{error}</div>}
          </div>
          <div className="card-f">
            <button type="button" className="btn ghost" onClick={close}>Cancel</button>
            <button type="submit" className={`btn${busy ? " busy" : ""}`} disabled={busy}><Icon name="check" size={16} />Save changes</button>
          </div>
        </form>
      )}
    </div>
  );
}
