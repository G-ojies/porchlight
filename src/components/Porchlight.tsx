"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { alertFor, takesOverScreen, type AlertStyle } from "@/lib/alert";
import { DEMO_SCENES, demoEvent } from "@/lib/demo";
import type { FrameDescription } from "@/lib/describe";
import { digestKind, type Digest, type DigestItem } from "@/lib/digest";
import type { DoorEvent, DoorKind } from "@/lib/door-event";

type Mode = "demo" | "live" | "loading";
type Reading = { kind: DoorKind; description: FrameDescription } | "pending" | "failed";
interface Device {
  id: string;
  name: string;
  online: boolean | null;
}

const POLL_MS = 5000;

function tz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function frameUrl(e: DoorEvent): string {
  if (e.demoImage) return e.demoImage;
  const q = new URLSearchParams({ device: e.deviceId, at: String(e.at), kind: e.ringKind });
  if (e.end) q.set("end", String(e.end));
  return `/api/snapshot?${q}`;
}

const RING_SAID: Record<DoorKind, string> = {
  ding: "doorbell press",
  person: "person",
  package: "package",
  vehicle: "vehicle",
  animal: "animal",
  motion: "motion",
  live_view: "live view",
  unknown: "event",
};

export default function Porchlight() {
  const [mode, setMode] = useState<Mode>("loading");
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<DoorEvent[]>([]);
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [alert, setAlert] = useState<DoorEvent | null>(null);
  const [tab, setTab] = useState<"door" | "care" | "connect">("door");
  const [notice, setNotice] = useState<string | null>(null);
  const [vibrate, setVibrate] = useState(true);
  const seen = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  /** Read one event's frame. Calls are queued so the vision model's rate limit is spent one at a time. */
  const read = useCallback((e: DoorEvent): Promise<Reading> => {
    setReadings((r) => (r[e.id] && r[e.id] !== "failed" ? r : { ...r, [e.id]: "pending" }));
    const job = queue.current.then(async () => {
      try {
        const res = await fetch("/api/describe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: e.deviceId, at: e.at, end: e.end ?? null, ringKind: e.ringKind, demoImage: e.demoImage ?? null }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const reading = (await res.json()) as { kind: DoorKind; description: FrameDescription };
        setReadings((r) => ({ ...r, [e.id]: reading }));
        return reading as Reading;
      } catch {
        setReadings((r) => ({ ...r, [e.id]: "failed" }));
        return "failed" as Reading;
      }
    });
    queue.current = job.catch(() => undefined);
    return job;
  }, []);

  /** A new event: read the frame first, so the alert says what is there, then take over the screen if it matters. */
  const arrive = useCallback(
    async (e: DoorEvent) => {
      const reading = await read(e);
      const kind = typeof reading === "object" ? reading.kind : e.ringKind;
      const style = alertFor(kind, e.at, tz());
      if (!takesOverScreen(style)) return;
      setAlert(e);
      if (vibrate && "vibrate" in navigator && style.vibrate.length) navigator.vibrate(style.vibrate);
      if ("Notification" in window && Notification.permission === "granted") {
        const caption = typeof reading === "object" ? reading.description.caption : "";
        new Notification(`${style.headline} - Porchlight`, { body: caption, tag: e.id });
      }
    },
    [read, vibrate],
  );

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/events", { cache: "no-store" });
      const body = await res.json();
      if (res.status === 401 && body.expired) {
        setNotice(body.error);
        setMode("live");
        return;
      }
      if (!res.ok) {
        setNotice(body.error ?? "Could not reach the server.");
        return;
      }
      setNotice(null);
      setMode(body.mode);
      setDevices(body.devices);
      if (body.mode !== "live") return;
      const incoming = body.events as DoorEvent[];
      const fresh = incoming.filter((e) => !seen.current.has(e.id));
      fresh.forEach((e) => seen.current.add(e.id));
      setEvents((old) => {
        const byId = new Map(old.map((e) => [e.id, e]));
        incoming.forEach((e) => byId.set(e.id, e));
        return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, 60);
      });
      if (firstLoad.current) {
        // Existing history fills the timeline without alerts; read the newest few frames.
        firstLoad.current = false;
        incoming.slice(0, 4).forEach((e) => void read(e));
      } else {
        fresh.sort((a, b) => a.at - b.at).forEach((e) => void arrive(e));
      }
    } catch {
      setNotice("Could not reach the server. Retrying.");
    }
  }, [arrive, read]);

  useEffect(() => {
    void poll();
    const t = setInterval(() => {
      if (mode === "live") void poll();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [poll, mode]);

  useEffect(() => {
    const original = "Porchlight";
    if (!alert) {
      document.title = original;
      return;
    }
    const r = readings[alert.id];
    const kind = typeof r === "object" ? r.kind : alert.ringKind;
    document.title = `(!) ${alertFor(kind, alert.at, tz()).headline} - ${original}`;
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && setAlert(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [alert, readings]);

  function simulate(sceneId: string) {
    const scene = DEMO_SCENES.find((s) => s.id === sceneId)!;
    const e = demoEvent(scene, Date.now());
    seen.current.add(e.id);
    setEvents((old) => [e, ...old].slice(0, 60));
    void arrive(e);
  }

  async function disconnect() {
    await fetch("/api/ring/connect", { method: "DELETE" });
    seen.current.clear();
    firstLoad.current = true;
    setEvents([]);
    setReadings({});
    setNotice(null);
    setTab("door");
    void poll();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Porchlight</h1>
          <p className="text-sm text-stone-600 dark:text-stone-400">Your doorbell, made visible.</p>
        </div>
        <ModeBadge mode={mode} devices={devices} />
      </header>

      <nav className="mb-5 flex gap-2" aria-label="Sections">
        {(
          [
            ["door", "Door"],
            ["care", "Caregiver summary"],
            ["connect", mode === "live" ? "Ring connection" : "Connect Ring"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === id ? "bg-stone-900 text-white dark:bg-white dark:text-black" : "bg-stone-200 dark:bg-stone-800"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-amber-100 p-3 text-sm text-amber-950">
          {notice}
        </p>
      )}

      {tab === "door" && (
        <section aria-label="Door">
          {mode === "demo" && <DemoPanel onSimulate={simulate} />}
          {mode === "live" && (
            <p className="mb-4 rounded-lg bg-sky-100 p-3 text-sm text-sky-950">
              Listening to Ring. Press <b>Package</b>, <b>Vehicle</b> or <b>Motion</b> in the Ring Developer Playground and an alert appears here within a few seconds.
            </p>
          )}
          <label className="mb-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={vibrate} onChange={(e) => setVibrate(e.target.checked)} /> Vibrate on alerts (phones)
          </label>
          <NotifyButton />
          <Timeline events={events} readings={readings} onOpen={setAlert} />
        </section>
      )}
      {tab === "care" && <CarePanel mode={mode} />}
      {tab === "connect" && <ConnectPanel mode={mode} onConnected={() => { firstLoad.current = true; setTab("door"); void poll(); }} onDisconnect={disconnect} />}

      <Credits />

      {alert && <AlertScreen event={alert} reading={readings[alert.id]} onClose={() => setAlert(null)} />}
    </div>
  );
}

function ModeBadge({ mode, devices }: { mode: Mode; devices: Device[] }) {
  if (mode === "loading") return null;
  if (mode === "demo")
    return <span className="rounded-full bg-stone-200 px-3 py-1 text-xs font-semibold dark:bg-stone-800">Demo mode</span>;
  const d = devices[0];
  return (
    <span className="rounded-full bg-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-950">
      Live: {d ? `${d.name}${d.online === false ? " (offline)" : ""}` : "no devices"}
    </span>
  );
}

function DemoPanel({ onSimulate }: { onSimulate: (id: string) => void }) {
  return (
    <div className="mb-5 rounded-xl border border-stone-300 p-4 dark:border-stone-700">
      <h2 className="font-bold">Try it</h2>
      <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">
        Each button sends what a Ring doorbell would report, with a frame from a real home camera. Porchlight reads the frame and alerts you. Connect a Ring token to use a live device instead.
      </p>
      <div className="flex flex-wrap gap-2">
        {DEMO_SCENES.map((s) => (
          <button key={s.id} onClick={() => onSimulate(s.id)} className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NotifyButton() {
  const [perm, setPerm] = useState<string>("default");
  useEffect(() => {
    if ("Notification" in window) setPerm(Notification.permission);
    else setPerm("unsupported");
  }, []);
  if (perm !== "default") return null;
  return (
    <button onClick={() => Notification.requestPermission().then(setPerm)} className="mb-4 rounded-lg border border-stone-400 px-3 py-2 text-sm">
      Also alert me when this tab is in the background
    </button>
  );
}

function Timeline({ events, readings, onOpen }: { events: DoorEvent[]; readings: Record<string, Reading>; onOpen: (e: DoorEvent) => void }) {
  if (!events.length) return <p className="text-stone-500">Nothing at the door yet.</p>;
  return (
    <ol className="space-y-3" aria-label="Door activity, newest first">
      {events.map((e) => {
        const r = readings[e.id];
        const kind = typeof r === "object" ? r.kind : e.ringKind;
        const style = alertFor(kind, e.at, tz());
        return (
          <li key={e.id}>
            <button onClick={() => onOpen(e)} className="flex w-full gap-3 rounded-xl bg-white p-3 text-left shadow-sm dark:bg-stone-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={frameUrl(e)} alt="" className="h-20 w-32 flex-none rounded-lg bg-stone-200 object-cover dark:bg-stone-800" loading="lazy" />
              <div className="min-w-0">
                <p className="font-bold">
                  <span aria-hidden>{style.icon} </span>
                  {style.headline} <span className="font-normal text-stone-500">at {clock(e.at)}</span>
                </p>
                <p className="text-sm">{r === "pending" ? "Reading the camera frame..." : typeof r === "object" ? r.description.caption : ""}</p>
                <Provenance event={e} reading={r} />
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Shows what Ring reported next to what the frame showed, so the person can see why the alert says what it says. */
function Provenance({ event, reading }: { event: DoorEvent; reading: Reading | undefined }) {
  const ring = `Ring: ${RING_SAID[event.ringKind]}`;
  if (typeof reading !== "object") return <p className="text-xs text-stone-500">{ring}</p>;
  const d = reading.description;
  const frame = d.by === "model" ? `frame: ${d.confident ? RING_SAID[d.seen] : "unclear"}` : "frame not read";
  return (
    <p className="text-xs text-stone-500">
      {ring} · {frame}
    </p>
  );
}

function AlertScreen({ event, reading, onClose }: { event: DoorEvent; reading: Reading | undefined; onClose: () => void }) {
  const kind = typeof reading === "object" ? reading.kind : event.ringKind;
  const style: AlertStyle = alertFor(kind, event.at, tz());
  const caption = typeof reading === "object" ? reading.description.caption : "Reading the camera frame...";
  const unsure = typeof reading === "object" && reading.description.by === "model" && !reading.description.confident;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="pl-alert-h" aria-describedby="pl-alert-c" className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 p-6 text-center ${style.tone} ${style.flash ? "pl-flash" : ""}`} onClick={onClose}>
      <p className="text-7xl" aria-hidden>
        {style.icon}
      </p>
      <h2 id="pl-alert-h" className="text-5xl font-black leading-tight sm:text-7xl" aria-live="assertive">
        {style.headline}
      </h2>
      <p id="pl-alert-c" className="max-w-2xl text-2xl font-semibold sm:text-3xl">
        {caption}
        {unsure && " (The picture is unclear.)"}
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={frameUrl(event)} alt={typeof reading === "object" ? reading.description.caption : "Camera frame"} className="max-h-[35vh] max-w-full rounded-xl border-4 border-black/70 object-contain" />
      <p className="text-lg">
        {event.deviceName} · {clock(event.at)}
      </p>
      <button ref={closeRef} onClick={onClose} className="rounded-full bg-black px-10 py-4 text-2xl font-bold text-white">
        Got it
      </button>
    </div>
  );
}

function CarePanel({ mode }: { mode: Mode }) {
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: tz() }).format(Date.now()));
  const [data, setData] = useState<{ digest: Digest; items: DigestItem[]; mode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    setError(null);
    fetch(`/api/digest?${new URLSearchParams({ date, tz: tz() })}`)
      .then(async (r) => (r.ok ? setData(await r.json()) : setError((await r.json()).error ?? "Could not load the summary.")))
      .catch(() => setError("Could not load the summary."));
  }, [date, mode]);
  return (
    <section aria-label="Caregiver summary" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold">
          Day{" "}
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="ml-1 rounded border border-stone-400 bg-transparent px-2 py-1" />
        </label>
        {data?.mode === "demo" && <span className="text-xs text-stone-500">Demo mode shows a sample day.</span>}
      </div>
      {error && <p className="text-red-700">{error}</p>}
      {!data && !error && <p className="text-stone-500">Loading...</p>}
      {data && (
        <>
          <div className="rounded-xl bg-white p-4 shadow-sm dark:bg-stone-900">
            <h2 className="mb-2 text-xl font-bold">{data.digest.total} door events</h2>
            <ul className="list-disc space-y-1 pl-5">
              {data.digest.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-stone-500">These counts are computed from Ring events, not written by an AI model. Only the one-line captions come from the vision model.</p>
          </div>
          <ol className="space-y-2">
            {[...data.items].sort((a, b) => a.at - b.at).map((i) => (
              <li key={i.id} className="flex gap-3 text-sm">
                <span className="w-14 flex-none font-mono">{clock(i.at)}</span>
                <span>
                  <b>{alertFor(digestKind(i), i.at, tz()).headline}.</b> {i.caption}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function ConnectPanel({ mode, onConnected, onDisconnect }: { mode: Mode; onConnected: () => void; onDisconnect: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function connect() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/ring/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setToken("");
      onConnected();
    } else setMsg(body.error ?? "Could not connect.");
  }
  return (
    <section aria-label="Ring connection" className="space-y-3">
      {mode === "live" ? (
        <>
          <p>Connected to Ring. The token is kept in a secure cookie for at most 30 minutes.</p>
          <button onClick={onDisconnect} className="rounded-lg bg-stone-900 px-4 py-2 font-semibold text-white dark:bg-white dark:text-black">
            Disconnect and go back to demo
          </button>
        </>
      ) : (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>
              Open the{" "}
              <a className="underline" href="https://developer.amazon.com/ring/console/playground" target="_blank" rel="noreferrer">
                Ring Developer Playground
              </a>{" "}
              and press <b>Generate Token</b>.
            </li>
            <li>Paste the access token below. It is checked with Ring, then kept server-side in an httpOnly cookie for up to 30 minutes.</li>
            <li>Back on the Playground, press Package, Vehicle or Motion.</li>
          </ol>
          <label className="block text-sm font-semibold" htmlFor="pl-token">
            Ring access token
          </label>
          <textarea id="pl-token" value={token} onChange={(e) => setToken(e.target.value)} rows={3} className="w-full rounded-lg border border-stone-400 bg-transparent p-2 font-mono text-xs" autoComplete="off" spellCheck={false} />
          <button disabled={busy || !token.trim()} onClick={connect} className="rounded-lg bg-stone-900 px-4 py-2 font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black">
            {busy ? "Checking with Ring..." : "Connect"}
          </button>
          {msg && <p className="text-red-700">{msg}</p>}
        </>
      )}
    </section>
  );
}

function Credits() {
  const seen = new Set<string>();
  const credits = DEMO_SCENES.map((s) => s.credit).filter((c) => !seen.has(c.url) && seen.add(c.url));
  return (
    <footer className="mt-12 space-y-2 border-t border-stone-300 pt-4 text-xs text-stone-500 dark:border-stone-700">
      <p>Camera frames in live mode come from Ring and are sent to a vision model (Groq) to write the caption. Porchlight keeps no images: frames and captions are cached in memory only.</p>
      <p>
        Demo frames are stills from home security videos on Wikimedia Commons, licensed CC BY 3.0, resized:{" "}
        {credits.map((c, i) => (
          <span key={c.url}>
            {i > 0 && "; "}
            <a className="underline" href={c.url}>
              {c.title}
            </a>{" "}
            by {c.author}
          </span>
        ))}
        . They are not Ring footage.
      </p>
      <p>
        Open source, MIT.{" "}
        <a className="underline" href="https://github.com/G-ojies/porchlight">
          github.com/G-ojies/porchlight
        </a>
      </p>
    </footer>
  );
}
