import { z } from "zod";
import type { DoorKind } from "./door-event";

/** What the vision model saw in one frame. */
export interface FrameDescription {
  /** One plain sentence, at most about 15 words, for the alert caption. */
  caption: string;
  /** The model's reading of the scene; "unknown" when it cannot tell. */
  seen: DoorKind;
  people: number;
  packageVisible: boolean;
  /** False when the frame is dark, blurred or ambiguous. */
  confident: boolean;
  /** "model" when the vision model answered, "fallback" when the text came from Ring's event type alone. */
  by: "model" | "fallback";
}

const SEEN = ["ding", "person", "package", "vehicle", "animal", "motion", "live_view", "unknown"] as const;

const ModelAnswer = z.object({
  caption: z.string().min(1).max(200),
  seen: z.enum(["person", "package", "vehicle", "animal", "motion", "unknown"]),
  people: z.number().int().min(0).max(20).catch(0),
  package_visible: z.boolean().catch(false),
  confident: z.boolean().catch(false),
});

export const VISION_PROMPT = `You describe one frame from a home doorbell camera for a person who is deaf or hard of hearing, or for their caregiver.

Reply with JSON only, no prose, in this shape:
{"caption": string, "seen": "person"|"package"|"vehicle"|"animal"|"motion"|"unknown", "people": number, "package_visible": boolean, "confident": boolean}

Rules for "caption":
- One short plain sentence, at most 15 words, present tense. Example: "A courier is holding a box at the door."
- Say only what is visible. Do not guess who someone is, their name, age, race, gender or mood. Say "a person" or "two people".
- Mention a uniform, a parcel, a vehicle or an animal when you can see one.
- If the frame is dark, blurred or empty, say so plainly, set "seen" to "unknown" and "confident" to false.
- No emoji, no markdown.`;

const FALLBACK: Record<DoorKind, string> = {
  ding: "The doorbell was pressed.",
  person: "Ring saw a person at the door.",
  package: "Ring saw a package delivery.",
  vehicle: "Ring saw a vehicle outside.",
  animal: "Ring saw an animal near the door.",
  motion: "Ring saw movement at the door.",
  live_view: "A live view of the door was opened.",
  unknown: "Something happened at the door.",
};

export function fallbackDescription(ringKind: DoorKind): FrameDescription {
  return {
    caption: FALLBACK[ringKind],
    seen: ringKind,
    people: 0,
    packageVisible: ringKind === "package",
    confident: false,
    by: "fallback",
  };
}

/** Parse the model's reply, tolerating code fences and leading prose. Null when unusable. */
export function parseModelReply(text: string): FrameDescription | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = ModelAnswer.safeParse(raw);
  if (!parsed.success) return null;
  const a = parsed.data;
  return {
    caption: tidyCaption(a.caption),
    seen: a.seen,
    people: a.people,
    packageVisible: a.package_visible,
    confident: a.confident,
    by: "model",
  };
}

function tidyCaption(s: string): string {
  const one = s.replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
  const words = one.split(" ");
  const cut = words.length > 22 ? `${words.slice(0, 22).join(" ")}...` : one;
  return /[.!?]$/.test(cut) || cut.endsWith("...") ? cut : `${cut}.`;
}

/**
 * Decide what to tell the person. Ring's own classification wins when it is
 * specific (a doorbell press is always a doorbell press); the frame decides
 * when Ring only knows "motion" or "live view", which is all the Playground's
 * simulated streams report.
 */
export function resolveKind(ringKind: DoorKind, d: FrameDescription | null): DoorKind {
  if (ringKind === "ding") return "ding";
  if (!d || d.by === "fallback" || !d.confident) return ringKind;
  // A person waiting at the door matters more than the box beside them; the caption still mentions it.
  if (d.seen === "person") return ringKind === "package" ? "package" : "person";
  const generic = ringKind === "motion" || ringKind === "live_view" || ringKind === "unknown";
  return generic && d.seen !== "unknown" ? d.seen : ringKind;
}

export function isDoorKind(s: string): s is DoorKind {
  return (SEEN as readonly string[]).includes(s);
}

export interface VisionConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  /** Total tries when rate limited (default 3). */
  attempts?: number;
  /** Longest rate-limit wait worth sitting through, in seconds (default 20). */
  maxWaitSeconds?: number;
}

export const DEFAULT_VISION_MODEL = "qwen/qwen3.8-27b";

/** Seconds to wait from a Groq rate-limit message such as "Please try again in 7.5s". */
export function retryAfterSeconds(message: string): number | null {
  const m = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(message);
  if (!m) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2]);
}

/** Describe one frame. Never throws: on any failure it returns the Ring-only fallback. */
export async function describeFrame(
  image: Uint8Array,
  contentType: string,
  ringKind: DoorKind,
  cfg: VisionConfig | null,
): Promise<FrameDescription> {
  if (!cfg?.apiKey) return fallbackDescription(ringKind);
  const fetcher = cfg.fetch ?? ((i, init) => fetch(i, init));
  const body = JSON.stringify({
    model: cfg.model || DEFAULT_VISION_MODEL,
    temperature: 0.1,
    max_tokens: 400,
    messages: [
      { role: "system", content: VISION_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `Ring reported: ${ringKind}. Describe the frame.` },
          { type: "image_url", image_url: { url: `data:${contentType};base64,${Buffer.from(image).toString("base64")}` } },
        ],
      },
    ],
  });

  const attempts = cfg.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetcher(`${cfg.baseUrl ?? "https://api.groq.com/openai/v1"}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 20000),
      });
      if (res.status === 429 && attempt < attempts - 1) {
        // Groq's free tier budgets ~2,000 input tokens per image against 7,000 a minute.
        const wait = retryAfterSeconds(await res.text());
        if (wait !== null && wait <= (cfg.maxWaitSeconds ?? 20)) {
          await new Promise((r) => setTimeout(r, wait * 1000 + 250));
          continue;
        }
        break;
      }
      if (!res.ok) break;
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const parsed = parseModelReply(data.choices?.[0]?.message?.content ?? "");
      if (parsed) return parsed;
      break;
    } catch {
      break;
    }
  }
  return fallbackDescription(ringKind);
}
