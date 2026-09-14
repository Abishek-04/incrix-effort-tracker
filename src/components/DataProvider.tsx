"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type EntryDraft } from "@/lib/api";
import type { Entry, Member, Rate } from "@/lib/types";
import { todayISO } from "@/lib/utils";

type MonthState = { entries: Entry[]; status: "loading" | "ready" | "error"; error?: string };

type DataCtx = {
  status: "loading" | "ready" | "error";
  error: string | null;
  reload: () => Promise<void>;
  team: Member[];
  rates: Rate[];
  memberById: Map<string, Member>;
  rateById: Map<string, Rate>;
  months: Record<string, MonthState>;
  ensureMonth: (month: string, force?: boolean) => void;
  viewMonth: string;
  setViewMonth: (month: string) => void;
  pending: number;
  pts: (e: Entry) => number;
  memberName: (e: Entry) => string;
  saveEntry: (d: EntryDraft, edit?: { id: string; prevMonth: string }) => Promise<Entry>;
  removeEntry: (e: Entry) => Promise<void>;
  restoreEntry: (e: Entry) => Promise<void>;
  addMember: (m: Pick<Member, "name" | "dept" | "target"> & Partial<Member>) => Promise<Member>;
  patchMember: (id: string, patch: Partial<Omit<Member, "id" | "order">>) => Promise<void>;
  removeMember: (m: Member) => Promise<void>;
  addRate: (r: Pick<Rate, "dept" | "type" | "rate"> & Partial<Rate>) => Promise<Rate>;
  patchRate: (id: string, patch: Partial<Omit<Rate, "id" | "order">>) => Promise<void>;
  removeRate: (r: Rate) => Promise<void>;
  restoreBackup: (data: unknown) => Promise<{ team: number; rates: number; entries: number }>;
  resetAll: () => Promise<void>;
};

const Ctx = createContext<DataCtx | null>(null);
const EMPTY: Entry[] = [];

export function DataProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<DataCtx["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState<Member[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [months, setMonths] = useState<Record<string, MonthState>>({});
  const [viewMonth, setViewMonth] = useState(() => todayISO().slice(0, 7));
  const [pending, setPending] = useState(0);

  const monthsRef = useRef(months);
  const teamRef = useRef(team);
  const ratesRef = useRef(rates);
  useEffect(() => { monthsRef.current = months; }, [months]);
  useEffect(() => { teamRef.current = team; }, [team]);
  useEffect(() => { ratesRef.current = rates; }, [rates]);
  const inflight = useRef(new Set<string>());

  const track = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    setPending((n) => n + 1);
    try {
      return await p;
    } finally {
      setPending((n) => n - 1);
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const b = await api.bootstrap();
      setTeam(b.team);
      setRates(b.rates);
      setError(null);
      setStatus("ready");
    } catch (e) {
      setError((e as Error).message);
      setStatus((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  const ensureMonth = useCallback((month: string, force = false) => {
    if (inflight.current.has(month)) return;
    const cur = monthsRef.current[month];
    if (!force && cur && cur.status !== "error") return;
    inflight.current.add(month);
    setMonths((s) => ({ ...s, [month]: { entries: s[month]?.entries ?? [], status: s[month]?.status === "ready" ? "ready" : "loading" } }));
    api
      .entries(month)
      .then((r) => setMonths((s) => ({ ...s, [month]: { entries: r.entries, status: "ready" } })))
      .catch((e: Error) => setMonths((s) => ({ ...s, [month]: { entries: s[month]?.entries ?? [], status: "error", error: e.message } })))
      .finally(() => inflight.current.delete(month));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Keep data fresh when several people use the tracker at once.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      reload();
      Object.keys(monthsRef.current).forEach((m) => ensureMonth(m, true));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload, ensureMonth]);

  const memberById = useMemo(() => new Map(team.map((m) => [m.id, m])), [team]);
  const rateById = useMemo(() => new Map(rates.map((r) => [r.id, r])), [rates]);
  const pts = useCallback((e: Entry) => { const r = rateById.get(e.typeId); return r ? (e.qty || 1) * r.rate : 0; }, [rateById]);
  const memberName = useCallback((e: Entry) => memberById.get(e.memberId)?.name ?? e.memberName, [memberById]);

  const putLocal = useCallback((e: Entry, prevMonth?: string) => {
    setMonths((s) => {
      const next = { ...s };
      if (prevMonth && next[prevMonth]) next[prevMonth] = { ...next[prevMonth], entries: next[prevMonth].entries.filter((x) => x.id !== e.id) };
      const m = e.date.slice(0, 7);
      if (next[m]?.status === "ready") next[m] = { ...next[m], entries: [e, ...next[m].entries.filter((x) => x.id !== e.id)] };
      return next;
    });
  }, []);

  const saveEntry = useCallback<DataCtx["saveEntry"]>(async (d, edit) => {
    const saved = edit ? await track(api.updateEntry(edit.id, { ...d, prevMonth: edit.prevMonth })) : await track(api.createEntry(d));
    putLocal(saved, edit?.prevMonth);
    return saved;
  }, [track, putLocal]);

  const removeEntry = useCallback(async (e: Entry) => {
    await track(api.deleteEntry(e.id, e.date.slice(0, 7)));
    const m = e.date.slice(0, 7);
    setMonths((s) => (s[m] ? { ...s, [m]: { ...s[m], entries: s[m].entries.filter((x) => x.id !== e.id) } } : s));
  }, [track]);

  const restoreEntry = useCallback(async (e: Entry) => {
    const saved = await track(api.createEntry({ id: e.id, date: e.date, memberId: e.memberId, typeId: e.typeId, desc: e.desc, client: e.client, qty: e.qty, hours: e.hours, status: e.status }));
    putLocal(saved);
  }, [track, putLocal]);

  const addMember = useCallback<DataCtx["addMember"]>(async (m) => {
    const saved = await track(api.createMember(m));
    setTeam((t) => [...t.filter((x) => x.id !== saved.id), saved].sort((a, b) => a.order - b.order));
    return saved;
  }, [track]);

  const patchMember = useCallback<DataCtx["patchMember"]>(async (id, patch) => {
    const prev = teamRef.current.find((m) => m.id === id);
    setTeam((t) => t.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    try {
      await track(api.updateMember(id, patch));
    } catch (e) {
      if (prev) setTeam((t) => t.map((m) => (m.id === id ? prev : m)));
      throw e;
    }
  }, [track]);

  const removeMember = useCallback(async (m: Member) => {
    await track(api.deleteMember(m.id));
    setTeam((t) => t.filter((x) => x.id !== m.id));
  }, [track]);

  const addRate = useCallback<DataCtx["addRate"]>(async (r) => {
    const saved = await track(api.createRate(r));
    setRates((list) => [...list.filter((x) => x.id !== saved.id), saved].sort((a, b) => a.order - b.order));
    return saved;
  }, [track]);

  const patchRate = useCallback<DataCtx["patchRate"]>(async (id, patch) => {
    const prev = ratesRef.current.find((r) => r.id === id);
    setRates((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try {
      await track(api.updateRate(id, patch));
    } catch (e) {
      if (prev) setRates((list) => list.map((r) => (r.id === id ? prev : r)));
      throw e;
    }
  }, [track]);

  const removeRate = useCallback(async (r: Rate) => {
    await track(api.deleteRate(r.id));
    setRates((list) => list.filter((x) => x.id !== r.id));
  }, [track]);

  const refreshAll = useCallback(async () => {
    setMonths({});
    monthsRef.current = {};
    await reload();
  }, [reload]);

  const restoreBackup = useCallback(async (data: unknown) => {
    const r = await track(api.restore(data));
    await refreshAll();
    return r;
  }, [track, refreshAll]);

  const resetAll = useCallback(async () => {
    await track(api.reset());
    await refreshAll();
  }, [track, refreshAll]);

  const value: DataCtx = {
    status, error, reload, team, rates, memberById, rateById, months, ensureMonth, viewMonth, setViewMonth, pending, pts, memberName,
    saveEntry, removeEntry, restoreEntry, addMember, patchMember, removeMember, addRate, patchRate, removeRate, restoreBackup, resetAll,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used inside <DataProvider>");
  return ctx;
}

/** Entries for one month, fetched on demand and cached. */
export function useMonth(month: string) {
  const { months, ensureMonth } = useData();
  useEffect(() => { ensureMonth(month); }, [month, ensureMonth]);
  const st = months[month];
  return {
    entries: st?.entries ?? EMPTY,
    loading: !st || st.status === "loading",
    error: st?.status === "error" ? st.error : undefined,
    retry: () => ensureMonth(month, true),
  };
}
