/**
 * Describe each bundled demo frame once with the real vision model and save the
 * result, so demo mode shows genuine model output without spending rate limit.
 * Usage: npx tsx scripts/bake-demo.ts   (needs GROQ_API_KEY in .env.local)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { describeFrame, type FrameDescription } from "../src/lib/describe";
import { DEMO_SCENES } from "../src/lib/demo";

const key = readFileSync(".env.local", "utf8").match(/GROQ_API_KEY=["']?([^"'\n]+)/)?.[1] ?? "";
const out = "src/lib/demo-captions.json";

(async () => {
  const done: Record<string, FrameDescription> = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
  for (const scene of DEMO_SCENES) {
    if (done[scene.image]?.by === "model") continue;
    const d = await describeFrame(readFileSync(`public${scene.image}`), "image/jpeg", scene.ringKind, {
      apiKey: key,
      attempts: 5,
      maxWaitSeconds: 60,
    });
    console.log(scene.image, d.by, d.caption);
    done[scene.image] = d;
    writeFileSync(out, `${JSON.stringify(done, null, 2)}\n`);
    await new Promise((r) => setTimeout(r, 25000));
  }
})();
