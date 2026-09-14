import { ZodError } from "zod";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Runs a route handler body and maps errors to consistent JSON responses. */
export async function handle(fn: () => Promise<unknown>, status = 200): Promise<Response> {
  try {
    const data = await fn();
    return Response.json(data ?? { ok: true }, { status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ZodError) {
      return Response.json(
        { error: e.issues[0]?.message ?? "Invalid input", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 },
      );
    }
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof SyntaxError) return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
    console.error("[api]", e);
    if ((e as Error)?.message?.startsWith("JWT_SECRET")) return Response.json({ error: "Sign-in isn't configured on the server (JWT_SECRET)" }, { status: 500 });
    const name = (e as Error)?.name;
    if (name === "ResourceNotFoundException") return Response.json({ error: "Database table not found — run `npm run db:setup`" }, { status: 500 });
    if (name === "UnrecognizedClientException" || name === "InvalidSignatureException" || name === "CredentialsProviderError")
      return Response.json({ error: "AWS credentials are missing or invalid" }, { status: 500 });
    return Response.json({ error: "Something went wrong on the server" }, { status: 500 });
  }
}
