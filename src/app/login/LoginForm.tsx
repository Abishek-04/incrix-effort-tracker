"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "@/components/Icon";

export function LoginForm({ next, expired }: { next: string; expired: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capsLock, setCapsLock] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) return setError("Enter your email and password");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, remember }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error || "Couldn't sign in. Please try again.");
        setBusy(false);
        return;
      }
      window.location.assign(next);
    } catch {
      setError("Can't reach the server — check your connection");
      setBusy(false);
    }
  }

  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.("CapsLock") ?? false);

  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="brand"><div className="logo">IX</div><div><b>Incrix</b><small>Effort Tracker</small></div></div>
        <div>
          <h1>Every task counted. Every target in view.</h1>
          <p>Log work in under a minute, track points against monthly targets and see how the whole team is doing.</p>
          <ul className="auth-points">
            <li><Icon name="log" />One-minute work logging with automatic points</li>
            <li><Icon name="dash" />Live dashboard, daily grid and exports</li>
            <li><Icon name="shield" />Secure sign-in with separate administrator access</li>
          </ul>
        </div>
        <div className="auth-foot">© {new Date().getFullYear()} Incrix · Internal tool</div>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-mobile-brand"><div className="logo">IX</div><div><b>Incrix</b><small>Effort Tracker</small></div></div>
          <h2>Sign in</h2>
          <p className="sub">Use your team or administrator login.</p>

          <form className="auth-form" onSubmit={submit} noValidate>
            {expired && !error && (
              <div className="auth-alert info" role="status"><Icon name="clock" size={16} />Your session ended. Please sign in again.</div>
            )}
            {error && <div className="auth-alert err" role="alert"><Icon name="alert" size={16} />{error}</div>}

            <div>
              <label className="lbl" htmlFor="email">Email</label>
              <input id="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div>
              <label className="lbl" htmlFor="password">Password</label>
              <div className="pwwrap">
                <input id="password" type={show ? "text" : "password"} autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={checkCaps} onKeyUp={checkCaps} />
                <button type="button" className="iconbtn" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>
                  <Icon name={show ? "eyeOff" : "eye"} size={16} />
                </button>
              </div>
              {capsLock && <div className="help" style={{ color: "var(--warn)" }}>Caps Lock is on</div>}
            </div>

            <label className="checkrow">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Keep me signed in for 30 days
            </label>

            <button type="submit" className={`btn lg${busy ? " busy" : ""}`} disabled={busy} style={{ width: "100%" }}>
              Sign in
            </button>
          </form>

          <p className="auth-help">Forgot the password? An administrator can change it in Setup → Access &amp; security.</p>
        </div>
      </main>
    </div>
  );
}
