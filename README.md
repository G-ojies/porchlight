# Porchlight

**Your doorbell, made visible.** Porchlight turns Ring doorbell events into full-screen visual alerts for people who are deaf or hard of hearing, and into a plain daily summary for the people who care for them.

A doorbell is a sound. If you cannot hear it, a parcel goes back to the depot, a visitor leaves, and a carer far away cannot tell whether anyone answered. Ring's own notifications say "There is motion at your Front Door". Porchlight looks at the frame and says what is there, in words large enough to read across a room:

> **Package delivered.** A cardboard package is sitting on the porch floor next to the door.

Live: **https://porchlight-ring.vercel.app** (demo mode works without a Ring account). Demo video: https://youtu.be/RjqqiGvBhRE

## What it does

- **Visual alerts.** A doorbell press, a person, a package or a vehicle takes over the screen with a colour, an icon, a headline of at most four words and a one-sentence caption of the camera frame. The screen edge flashes (a steady border under `prefers-reduced-motion`), phones vibrate with a different rhythm for each kind, and a browser notification fires when the tab is in the background. Movement and animals go to the timeline only, so the screen is not taken over for a bird.
- **The frame decides when Ring cannot.** Ring classifies motion only when Smart Alerts is on, and the Ring Developer Playground's simulated streams arrive as plain live views. Porchlight reads the frame with a vision model and upgrades a generic event to "package" or "person". A doorbell press is always a doorbell press. Every timeline entry shows both readings (`Ring: live view · frame: package`) so the person can see why the alert says what it says, and an unclear frame says so instead of guessing.
- **Caregiver summary.** For any day: doorbell presses that nobody answered (no live view within three minutes), activity between 22:00 and 06:00, packages, and long quiet stretches. These numbers are computed from Ring events in code, never written by a model.
- **At night, people come first.** A person or vehicle between 22:00 and 06:00 is raised to an urgent alert.

## Ring integration

All Ring calls are server-to-server (Ring blocks browser requests), through a small typed client in [`src/lib/ring`](src/lib/ring), written from the [Ring Partner API documentation](https://developer.amazon.com/docs/ring/api-documentation.html) and published separately as an MIT kit:

| Ring API | Used for |
| --- | --- |
| `GET /v1/devices?include=status` | devices and online state (JSON:API compound document) |
| `GET /v1/history/devices/{id}/events` | the event stream, polled every 5 s, with composite `event_types` filters and `links.next` paging |
| `POST /v1/devices/{id}/media/image/download` | the frame for each event: `at_timestamp` for presses and motion, `latest_in_range` for live views, at 640x360; follows the 303 to the pre-signed URL without the bearer token |
| Webhooks v1.1 (`motion_detected`, `button_press`) | `POST /api/webhooks/ring` verifies `X-Signature` (HMAC-SHA256, hex, over the raw body, constant-time), drops retried deliveries by `request_id` and reads `attributes.sub_type` |

### Try it with the Ring Developer Playground

You do not need a Ring device.

1. Open the [Ring Developer Playground](https://developer.amazon.com/ring/console/playground) and press **Generate Token**.
2. In Porchlight, open **Connect Ring** and paste the token. Porchlight checks it with Ring and keeps it server-side in an httpOnly, SameSite=Strict cookie for at most 30 minutes (the token's own lifetime).
3. Press **Package**, **Vehicle** or **Motion** in the Playground. The alert appears within a few seconds.

### Demo mode

Without a token, Porchlight runs on stills from real home security videos published on Wikimedia Commons under CC BY 3.0 (credited in the app and in [`src/lib/demo.ts`](src/lib/demo.ts)). They are **not Ring footage**. Their captions were produced once by the same vision model (`scripts/bake-demo.ts`) and stored, so the demo shows real model output without spending rate limit.

## Privacy and safety

- The vision prompt describes only what is visible and forbids guessing who someone is, their name, age, race, gender or mood. People are "a person".
- Frames are sent to Groq to write the caption and are not stored. Frames and captions are cached in server memory only.
- If the model fails, is rate-limited for long, or returns something unusable, the alert falls back to Ring's own event type. An alert is never delayed for a caption.
- The caregiver summary contains no model-written numbers.

## Run it

```bash
npm install
cp .env.example .env.local   # add GROQ_API_KEY (free tier is enough)
npm run dev                  # http://localhost:3000
npm test                     # 26 tests: Ring client, webhook signatures, frame reading, digest
npm run typecheck && npm run lint
```

Stack: Next.js 14 (App Router), TypeScript, Tailwind. Vision: `qwen/qwen3.8-27b` on Groq. No database.

## Licence

MIT. Demo images: CC BY 3.0, their authors as credited.
