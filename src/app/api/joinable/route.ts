import { requireSession } from "@/server/auth";
import { joinableEntries } from "@/server/db";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

/** Recent work anyone can join, from every department. Used only by the log form's picker. */
export function GET(req: Request) {
  return handle(async () => {
    await requireSession();
    const q = new URL(req.url).searchParams;
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const to = iso.test(q.get("to") ?? "") ? q.get("to")! : new Date().toISOString().slice(0, 10);
    const from = iso.test(q.get("from") ?? "") ? q.get("from")! : to;
    return { entries: await joinableEntries(from, to) };
  });
}
