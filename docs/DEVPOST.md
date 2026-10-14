# Devpost submission: Porchlight

**Tagline:** Your doorbell, made visible. Ring alerts for people who are deaf or hard of hearing, and a daily door summary for their carers.

**Tracks:** Ring (primary). Mini challenge: Open Source (ring-partner-kit).

## Inspiration

A doorbell is a sound. If you are deaf or hard of hearing, a parcel goes back to the depot and a visitor walks away, and a carer who lives far away has no way to know whether anyone answered the door. Ring already knows when something happens at the door, but its alerts are short notifications ("There is motion at your Front Door") that assume you will hear a chime or look at your phone in time. We wanted the screen itself to become the doorbell, and we wanted it to say what is actually there.

## What it does

- **Visual alerts.** A doorbell press, a person, a package or a vehicle takes over the screen: a colour per kind of event, a headline of at most four words readable across a room, a one-sentence description of the camera frame, and the frame itself. The edge flashes (a steady border with reduced motion), phones vibrate with a different rhythm per kind, and a browser notification fires when the tab is in the background. Movement and animals stay in the timeline so a bird never takes over the screen. People and vehicles at night (22:00 to 06:00) become urgent.
- **The frame decides when Ring cannot.** Ring only classifies motion when Smart Alerts is switched on, and the Ring Developer Playground's simulated streams arrive as plain live views. Porchlight downloads the frame through the Image Snapshots API and asks a vision model what is visible. A live view showing a box becomes "Package delivered: a cardboard package is sitting on the snowy front steps". A doorbell press always stays a doorbell press. Every timeline entry shows both readings ("Ring: live view · frame: package"), so the person can see why the alert says what it says, and an unclear frame says so rather than guessing.
- **Caregiver summary.** For any day: doorbell presses nobody answered (no live view within three minutes), activity at night, deliveries, and long quiet stretches. These numbers are computed from Ring events in code. No model writes them.

## How we built it

Next.js 14 and TypeScript on Vercel, with no database.

**Ring Partner API** (all calls server-to-server, through our own typed client):
- `GET /v1/devices?include=status`: find the doorbell and its online state.
- `GET /v1/history/devices/{id}/events`: polled every 5 seconds, with paging.
- `POST /v1/devices/{id}/media/image/download`: the frame for each event, at 640x360, following the 303 to the pre-signed URL. It waits for fresh media, which takes a few seconds after an event.
- Webhooks v1.1: the receiver verifies `X-Signature` (HMAC-SHA256 over the raw body, constant-time), drops retried deliveries by `request_id`, and reads `attributes.sub_type`.

We tested it live against the Ring Developer Playground with a Playground token. The token is checked with Ring and then kept server-side in an httpOnly cookie for at most 30 minutes.

**Vision:** `qwen/qwen3.8-27b` on Groq's free tier. The prompt asks for JSON, describes only what is visible and forbids guessing who someone is, their age, race, gender or mood. Captions are cached per event, and calls are queued so a burst of events stays within the rate limit. If the model is unavailable, the alert falls back to Ring's own event type, so an alert is never held up waiting for a caption.

**Open source mini challenge:** the Ring client is published on its own as [ring-partner-kit](https://github.com/G-ojies/ring-partner-kit) (MIT). It is a dependency-free TypeScript client covering devices, event history, two-step snapshots and verified webhooks, with tests.

**Demo mode:** visitors without a Ring token get stills from real home-security videos on Wikimedia Commons (CC BY 3.0, credited in the app). These are not Ring footage. Their captions came from the same vision model and were stored once.

26 tests cover the Ring client against the documented shapes, webhook signatures (including the "re-serialised JSON must not verify" case), frame reading and fallbacks, and the digest rules.

## Challenges we ran into

- **The Playground only simulates live views.** All we saw was `on_demand` with no subtype. So we made the frame, not the event type, decide what the alert says, and showed both readings so the decision is visible.
- **Fresh events are not ready at once.** A Playground event appears in history only after its 30-second stream ends, and its snapshot fails for a few seconds. We added a media-ready retry.
- **Getting in.** The Amazon sign-in code for our existing account went to WhatsApp and never arrived, so we created a new developer account to reach the Playground.
- **A free vision model on a doorbell.** Groq's free tier budgets about 2,000 tokens per image. We cut frames to 640x360, cache per event, queue calls and retry on short rate limits.

## Accomplishments that we're proud of

A real Ring frame, from a simulated doorbell, turned into a plain sentence on a screen you can read from across the room, end to end, within seconds of the frame being available.

## What we learned

For accessibility, an honest "the picture is unclear" is better than a confident guess. Showing "what Ring said" next to "what the frame showed" turned a black box into something a person can trust.

## What's next for Porchlight

- A doorbell-press flow and webhooks, once the Playground can simulate them.
- A Ring Chime that flashes a lamp through a smart plug.
- A wearable vibration alert.
- Opt-in SMS for carers.

## Built with

ring-partner-api, ring-developer-playground, next.js, typescript, tailwindcss, vercel, groq, qwen, node.js

## Links

- Live: https://porchlight-ring.vercel.app
- Code: https://github.com/G-ojies/porchlight
- Open source kit: https://github.com/G-ojies/ring-partner-kit
