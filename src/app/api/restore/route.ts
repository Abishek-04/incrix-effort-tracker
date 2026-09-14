import { requireSession } from "@/server/auth";
import { normalizeBackup, restoreAll } from "@/server/db";
import { handle } from "@/server/http";
import { readJson } from "@/server/request";

export function POST(req: Request) {
  // Accepts backups from this app and from the original single-file HTML tracker.
  return handle(async () => {
    await requireSession("admin");
    return restoreAll(normalizeBackup(await readJson(req)));
  });
}
