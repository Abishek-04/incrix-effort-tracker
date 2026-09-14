import { HttpError } from "./http";

/** Reads a JSON body. Requiring the JSON content type blocks simple cross-site form posts. */
export async function readJson(req: Request): Promise<unknown> {
  if (!req.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Expected application/json");
  return req.json();
}
