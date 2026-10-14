import type { DoorKind } from "./door-event";

export type Priority = "urgent" | "notice" | "quiet";

export interface AlertStyle {
  priority: Priority;
  /** Large text, at most four words, readable across a room. */
  headline: string;
  /** Single glyph shown beside the headline; text alternatives are in the headline itself. */
  icon: string;
  /** Tailwind classes for the full-screen alert (all pairs pass WCAG AA contrast). */
  tone: string;
  /** navigator.vibrate pattern; empty for none. Each kind has its own rhythm so it can be told apart by touch. */
  vibrate: number[];
  /** Whether the screen edge flashes (replaced by a steady border under reduced motion). */
  flash: boolean;
}

const STYLES: Record<DoorKind, AlertStyle> = {
  ding: { priority: "urgent", headline: "Doorbell", icon: "🔔", tone: "bg-amber-300 text-black", vibrate: [400, 150, 400, 150, 400], flash: true },
  person: { priority: "urgent", headline: "Someone outside", icon: "🧍", tone: "bg-sky-300 text-black", vibrate: [600, 200, 600], flash: true },
  package: { priority: "notice", headline: "Package delivered", icon: "📦", tone: "bg-lime-300 text-black", vibrate: [200, 100, 200, 100, 200, 100, 200], flash: true },
  vehicle: { priority: "notice", headline: "Vehicle outside", icon: "🚗", tone: "bg-violet-300 text-black", vibrate: [800], flash: false },
  animal: { priority: "quiet", headline: "Animal outside", icon: "🐾", tone: "bg-stone-200 text-black", vibrate: [], flash: false },
  motion: { priority: "quiet", headline: "Movement outside", icon: "〰️", tone: "bg-stone-200 text-black", vibrate: [], flash: false },
  live_view: { priority: "quiet", headline: "Live view opened", icon: "📹", tone: "bg-stone-200 text-black", vibrate: [], flash: false },
  unknown: { priority: "quiet", headline: "Door activity", icon: "•", tone: "bg-stone-200 text-black", vibrate: [], flash: false },
};

export function isNight(at: number, timeZone: string): boolean {
  const h = hourIn(at, timeZone);
  return h >= 22 || h < 6;
}

export function hourIn(at: number, timeZone: string): number {
  const s = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(at);
  return Number(s);
}

/**
 * The alert for one event. A person or vehicle at night is raised to urgent,
 * because that is when a missed visitor matters most to someone living alone.
 */
export function alertFor(kind: DoorKind, at: number, timeZone: string): AlertStyle {
  const base = STYLES[kind];
  if (isNight(at, timeZone) && (kind === "person" || kind === "vehicle") && base.priority !== "urgent") {
    return { ...base, priority: "urgent", flash: true, vibrate: base.vibrate.length ? base.vibrate : [600, 200, 600] };
  }
  return base;
}

/** Quiet events go to the timeline only; they never take over the screen. */
export function takesOverScreen(style: AlertStyle): boolean {
  return style.priority !== "quiet";
}
