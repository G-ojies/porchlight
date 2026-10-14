import { NextRequest, NextResponse } from "next/server";
import { RingApiError, RingClient } from "@/lib/ring";
import { TOKEN_COOKIE, TOKEN_MAX_AGE } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Store a Ring access token (from the Ring Developer Playground) in an
 * httpOnly cookie after checking it works. The token never reaches page script again.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim().replace(/^Bearer\s+/i, "") : "";
  if (token.length < 20 || token.length > 8192 || /\s/.test(token)) return NextResponse.json({ error: "That does not look like a Ring access token." }, { status: 400 });
  try {
    const devices = await new RingClient({ token }).listDevices();
    const res = NextResponse.json({ ok: true, devices });
    res.cookies.set(TOKEN_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: TOKEN_MAX_AGE });
    return res;
  } catch (e) {
    const status = e instanceof RingApiError ? e.status : 502;
    return NextResponse.json(
      { error: status === 401 || status === 403 ? "Ring rejected that token. Generate a new one in the Playground." : "Could not reach Ring. Try again." },
      { status: status === 401 || status === 403 ? 401 : 502 },
    );
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(TOKEN_COOKIE);
  return res;
}
