import { NextResponse } from "next/server";

/**
 * Proxy for the GuardRail x402 merchant. The merchant runs internally on
 * :8787 with no browser CORS, so the web client talks to this route instead.
 *
 *   GET  /api/x402/[kind]              -> merchant 402 challenge (price quote)
 *   POST /api/x402/[kind]  {envelope}  -> forward X-PAYMENT, serve report
 *
 * Payment is signed CLIENT-SIDE by the connected user's wallet (EIP-3009
 * TransferWithAuthorization in $U). This route just relays the signed
 * envelope to the merchant, which verifies the signature + settles onchain.
 * The $U leaves the USER's wallet, not the server's.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (!/^(health|yield|lp|grid)$/.test(kind)) {
    return NextResponse.json({ ok: false, error: "bad kind" }, { status: 400 });
  }
  const merchantUrl = process.env.GUARDRAIL_MERCHANT_URL ?? "http://127.0.0.1:8787";
  // Forward the X-PAYMENT / PAYMENT-SIGNATURE header if the client already
  // signed (the merchant serves the report on a paid GET; a bare GET is the
  // 402 challenge).
  const payment = req.headers.get("x-payment");
  const sig = req.headers.get("payment-signature");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (payment) headers["X-PAYMENT"] = payment;
  if (sig) headers["PAYMENT-SIGNATURE"] = sig;
  try {
    const r = await fetch(`${merchantUrl}/v1/agents/${kind}`, { headers });
    const body = await r.json();
    return NextResponse.json(body, { status: r.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `merchant unreachable: ${String(e)}` }, { status: 502 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (!/^(health|yield|lp|grid)$/.test(kind)) {
    return NextResponse.json({ ok: false, error: "bad kind" }, { status: 400 });
  }
  let payload: { envelope?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (!payload.envelope) {
    return NextResponse.json({ ok: false, error: "missing envelope" }, { status: 400 });
  }
  const header = Buffer.from(JSON.stringify(payload.envelope)).toString("base64");

  const merchantUrl = process.env.GUARDRAIL_MERCHANT_URL ?? "http://127.0.0.1:8787";
  try {
    const r = await fetch(`${merchantUrl}/v1/agents/${kind}`, {
      headers: { "X-PAYMENT": header, "PAYMENT-SIGNATURE": header, "content-type": "application/json" },
    });
    const body = await r.json();
    return NextResponse.json(body, { status: r.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `merchant unreachable: ${String(e)}` }, { status: 502 });
  }
}
