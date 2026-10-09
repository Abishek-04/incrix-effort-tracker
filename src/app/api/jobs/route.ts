import { requireSession } from "@/server/auth";
import { handle } from "@/server/http";
import { createJob, listJobs } from "@/server/jobs";
import { readJson } from "@/server/request";
import { jobCreate } from "@/server/validation";
import { JOB_STATUSES } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Everyone signed in can see and create job cards — they need them to log shared work. */
export function GET(req: Request) {
  return handle(async () => {
    await requireSession();
    const status = new URL(req.url).searchParams.get("status");
    const filter = JOB_STATUSES.find((s) => s === status);
    return { jobs: await listJobs(filter) };
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession();
    return createJob(jobCreate.parse(await readJson(req)), session.email);
  }, 201);
}
