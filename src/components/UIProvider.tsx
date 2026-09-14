"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type ToastOpts = { error?: boolean; label?: string; action?: () => void };
type ConfirmOpts = { title: string; body: string; ok?: string; icon?: IconName };
type UICtx = { toast: (msg: string, opts?: ToastOpts) => void; confirm: (opts: ConfirmOpts) => Promise<boolean> };

const Ctx = createContext<UICtx | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; msg: string; opts: ToastOpts; out?: boolean }[]>([]);
  const [dialog, setDialog] = useState<ConfirmOpts | null>(null);
  const dlgRef = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, out: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 200);
  }, []);

  const toast = useCallback<UICtx["toast"]>((msg, opts = {}) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, msg, opts }]);
    setTimeout(() => dismiss(id), opts.label ? 6000 : opts.error ? 5000 : 3000);
  }, [dismiss]);

  const confirm = useCallback<UICtx["confirm"]>((opts) => {
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setDialog(opts);
      const d = dlgRef.current;
      if (d && !d.open) { d.returnValue = ""; d.showModal(); }
    });
  }, []);

  // One floating tooltip for every element with data-tip.
  useEffect(() => {
    const tip = tipRef.current!;
    const over = (e: MouseEvent) => {
      const el = (e.target as Element).closest?.("[data-tip]") as HTMLElement | null;
      if (!el) { tip.classList.remove("show"); return; }
      tip.textContent = el.dataset.tip ?? "";
      tip.classList.add("show");
      const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      const x = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, innerWidth - tw - 8));
      let y = r.top - th - 8;
      if (y < 8) y = r.bottom + 8;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    };
    const hide = () => tip.classList.remove("show");
    document.addEventListener("mouseover", over);
    document.addEventListener("scroll", hide, true);
    return () => { document.removeEventListener("mouseover", over); document.removeEventListener("scroll", hide, true); };
  }, []);

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.opts.error ? " err" : ""}${t.out ? " out" : ""}`} role={t.opts.error ? "alert" : "status"}>
            <Icon name={t.opts.error ? "alert" : "checkc"} />
            <span>{t.msg}</span>
            {t.opts.label && (
              <button type="button" onClick={() => { dismiss(t.id); t.opts.action?.(); }}>{t.opts.label}</button>
            )}
          </div>
        ))}
      </div>
      <div id="tip" ref={tipRef} role="tooltip" />
      <dialog
        ref={dlgRef}
        onClose={() => { resolver.current?.(dlgRef.current?.returnValue === "yes"); resolver.current = null; }}
      >
        <form method="dialog">
          <div className="dlg-b">
            <div className="dlg-i"><Icon name={dialog?.icon ?? "warn"} size={20} /></div>
            <div><h3>{dialog?.title}</h3><p>{dialog?.body}</p></div>
          </div>
          <div className="dlg-f">
            <button className="btn sec" value="no">Cancel</button>
            <button className="btn danger" value="yes">{dialog?.ok ?? "Confirm"}</button>
          </div>
        </form>
      </dialog>
    </Ctx.Provider>
  );
}

export function useUI() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUI must be used inside <UIProvider>");
  return ctx;
}
