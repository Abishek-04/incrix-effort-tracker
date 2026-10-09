import { requireSession } from "@/server/auth";
import { handle } from "@/server/http";
import { confirmJob, deleteJob, updateJob } from "@/server/jobs";
import { readJson } from "@/server/request";
import { jobPatch } from "@/server/validation";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const session = await requireSession();
    const { id } = await params;
    const { confirmed, ...patch } = jobPatch.parse(await readJson(req));
    // Only an administrator can vouch for a card's points.
    if (confirmed !== undefined) {
      const s = await requireSession("admin");
      const job = await confirmJob(id, s.email, confirmed);
      return Object.keys(patch).length ? updateJob(id, patch) : job;
    }
    void session;
    return updateJob(id, patch);
  });
}

/** Only administrators remove a card, and only once nothing is logged against it. */
export function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession("admin");
    return deleteJob((await params).id);
  });
}
