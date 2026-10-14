# Friction log

Problems hit first-hand while building Porchlight against the Ring Partner API and the Ring Developer Playground, 14 October 2026, from Nigeria. Each has what happened, why it mattered, and a suggestion.

## 1. Playground events only appear in history after the simulated stream ends

**What happened.** Pressing **Package** in the Playground starts a roughly 30-second simulated live view. `GET /v1/history/devices/{id}/events` returned an empty list straight after the press. The event (`event_type: on_demand`, start 22:29:45 Z, end 22:30:16 Z) showed up only after the stream had ended.
**Why it matters.** An app that polls history to react to the doorbell looks broken for the first half-minute, and the docs give no hint of the delay.
**Suggestion.** Document when a history row becomes visible (at start or at end of the event), or emit the Playground events as webhooks so apps can test real-time handling.

## 2. Snapshots for a fresh event return 404 for a few seconds

**What happened.** `POST /v1/devices/{id}/media/image/download` for the newest event returned an error the first time and a 640x360 JPEG a few seconds later, with no other change.
**Why it matters.** The natural flow, "event arrives, fetch its frame", fails on the first try. I had to add a retry loop (four rounds, three seconds apart).
**Suggestion.** Return a distinct status such as `425 Too Early` or `409 MEDIA_NOT_READY` with `Retry-After`, and state the expected delay in the Image Snapshots section.

## 3. The Playground can only simulate live views

**What happened.** The Playground has one DoorbellPro and three buttons (Package, Vehicle, Motion), each of which starts a simulated live view. The Package press I tested produced an `on_demand` history event with no subtype (other entrants on the Devpost forum report the same for Vehicle and Motion). There is no way to simulate a `ding` (doorbell press), a `motion` event with `sub_type`, or any webhook delivery.
**Why it matters.** The most important event for an accessibility app, the doorbell press, cannot be tested live. My webhook receiver (HMAC check, `request_id` de-duplication, `sub_type` handling) is tested only against the payloads printed in the docs.
**Suggestion.** Add Ding and Motion (with Smart Alert subtypes) buttons, and let the Playground send signed webhooks to a URL the developer enters.

## 4. Closing the Playground tab locks you out of a new token for 30 minutes

**What happened.** I closed the tab that held my token. The new tab said "You have an active token. For security, it is not displayed. You can generate a new token in 28 minutes." The Package, Vehicle and Motion buttons are hidden until a token is visible, so I could not simulate anything for half an hour.
**Suggestion.** Allow revoking the active token and generating a new one, or keep the simulation buttons available while an active token exists.

## 5. Sign-in for the developer console was blocked by a WhatsApp-only code

**What happened.** My existing Amazon account sends its two-step code only to WhatsApp or a voice call on an old number. Neither arrived, so I created a new Amazon account just to reach the Playground.
**Suggestion.** For developer-console sign-in, offer an email code or an authenticator app as a fallback.

## 6. Choosing a country in developer registration clears the address

**What happened.** On the Amazon Developer registration form, choosing the country after filling the address cleared Address, City, State and Postal code. The country picker defaults to Afghanistan and is a custom control, not a `<select>`.
**Suggestion.** Keep the entered address when the country changes, or put the country field first.

## What worked well

- `GET /v1/devices?include=status` in one call, with JSON:API `included`, is clean to parse.
- The two-step snapshot flow (303 to a pre-signed URL) is documented precisely, including the warning not to send the bearer token to the pre-signed URL and to send `components` on a multi-camera device.
- The webhook section's warning to verify the HMAC over the raw bytes, not re-serialised JSON, saved me a real bug, and I turned it into a test.
