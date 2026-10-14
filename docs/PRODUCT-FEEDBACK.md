# Product feedback

Answers for the five feedback questions on the Devpost form. Details and suggestions are in [FRICTION-LOG.md](FRICTION-LOG.md).

## 1. Which developer tools, APIs and SDKs did you use and for what?

The Ring Partner API at api.amazonvision.com, through a small TypeScript client I wrote from the documentation and published as an open source kit. I used Device Discovery with `include=status` to find the doorbell and check it is online, Event History to follow what happens at the door, and Image Snapshots to download the frame for each event so a vision model can say what is in it. I also built a webhook receiver for `motion_detected` and `button_press` that verifies the HMAC signature and reads `sub_type`. I tested everything live against the Ring Developer Playground and its simulated doorbell, with a Playground token. The sample app `ring-api-helloworld` was my reference for the auth and webhook shapes.

## 2. What worked well?

The documentation is precise where it counts. The snapshot section explains the 303 redirect, says not to send the bearer token to the pre-signed URL, and covers multi-camera devices, so my snapshot code worked the first time it met the real API. The webhook section warns that the HMAC must be computed over the raw body bytes, which is exactly the bug people make, and I turned that warning into a test. The Playground is the reason I could build this at all: I live in Nigeria and do not own a Ring device, and with a token and one click I had a real doorbell frame with Ring's watermark in my app.

## 3. What needs work?

The Playground only simulates live views: its Package button produced an `on_demand` event with no subtype, and there is no way to simulate a doorbell press or a webhook, which are the two events an accessibility app cares about most. A new event only appears in history after its 30-second stream ends, and its snapshot returns an error for a few seconds before the media is ready. Neither delay is documented, so the first version of my app looked broken. Closing the Playground tab locked me out of a new token for 30 minutes.

## 4. How was your onboarding experience?

The API side was fast: from the Playground token to my first device list was a few minutes. Getting into the console was the hard part. My existing Amazon account sends its sign-in code only by WhatsApp or a phone call, neither arrived, and I had to create a new Amazon account to continue. On the developer registration form, picking the country cleared the address I had already typed.

## 5. Would you build with these devices and services again?

Yes. A doorbell is one of the few devices in a home that tells you someone needs you right now, and for people who cannot hear it, an API that gives me the event and the frame is the whole product. I would build more of Porchlight on Ring: a doorbell-press flow and webhooks once the Playground can simulate them, and a Chime that flashes instead of rings. What would bring me back faster is a Playground that can fire a ding, motion with Smart Alert subtypes, and signed webhooks.
