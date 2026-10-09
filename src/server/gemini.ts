// Server-only Google Gemini client. The API key never leaves the server.
import { HttpError } from "./http";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** Tried in order: a busy model answers 503, so the next one takes over. */
const DEFAULT_MODELS = "gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite";
const ATTEMPTS_PER_MODEL = 2;
const TIMEOUT_MS = 60_000;

export type Schema = {
  type: "OBJECT" | "ARRAY" | "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN";
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  enum?: string[];
  description?: string;
  propertyOrdering?: string[];
};

const models = () => (process.env.GEMINI_MODELS || DEFAULT_MODELS).split(",").map((m) => m.trim()).filter(Boolean);
const retriable = (status: number) => status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asks Gemini for JSON matching `schema` and returns it parsed. */
export async function generateJson<T>(opts: { system: string; prompt: string; schema: Schema; temperature?: number }): Promise<{ data: T; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(500, "AI analysis isn't configured on the server (GEMINI_API_KEY)");

  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    systemInstruction: { parts: [{ text: opts.system }] },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: opts.schema,
      temperature: opts.temperature ?? 0.4,
    },
  });

  let lastError = "The AI service didn't respond";
  for (const model of models()) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        lastError = (e as Error).name === "TimeoutError" ? "The AI service took too long to reply" : "Couldn't reach the AI service";
        continue;
      }

      const text = await res.text();
      if (!res.ok) {
        const message = (JSON.parse(text || "{}") as { error?: { message?: string } }).error?.message ?? `AI request failed (${res.status})`;
        lastError = message;
        if (res.status === 400 || res.status === 403) throw new HttpError(500, `AI request rejected: ${message}`);
        if (!retriable(res.status)) break; // e.g. 404 — this model is gone, try the next one
        await sleep(400 * attempt);
        continue;
      }

      const parsed = JSON.parse(text) as {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
        promptFeedback?: { blockReason?: string };
      };
      const candidate = parsed.candidates?.[0];
      if (parsed.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY") {
        throw new HttpError(422, "The AI declined to analyse this data. Try again, or reword your recommendations.");
      }
      if (candidate?.finishReason && candidate.finishReason !== "STOP") {
        lastError = `The AI reply was cut short (${candidate.finishReason})`;
        continue;
      }
      const out = candidate?.content?.parts?.find((p) => typeof p.text === "string")?.text;
      if (!out) {
        lastError = "The AI returned an empty reply";
        continue;
      }
      try {
        return { data: JSON.parse(out) as T, model };
      } catch {
        lastError = "The AI returned a reply that wasn't valid JSON";
      }
    }
  }
  throw new HttpError(503, `${lastError}. Please try again in a moment.`);
}
