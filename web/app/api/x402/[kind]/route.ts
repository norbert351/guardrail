import { NextResponse } from "next/server";
import { callMerchant, merchantDownMessage } from "@/lib/merchant";

export const dynamic = "force-dynamic";

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
 *
 * The merchant host is resolved via `lib/merchant.ts`, which falls back across
 * known-good hosts so a stale `GUARDRAIL_MERCHANT_URL` (e.g. after a Render
 * service is re-created under a new hostname) cannot silently kill the Buy path.
 */
const KINDS = /^(health|yield|lp|grid)$/;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (!KINDS.test(kind)) {
    return NextResponse.json({ ok: false, error: "bad kind" }, { status: 400 });
  }

  // Forward the X-PAYMENT / PAYMENT-SIGNATURE header if the client already
  // signed (the merchant serves the report on a paid GET; a bare GET is the
  // 402 challenge).
  const headers: Record<string, string> = { "content-type": "application/json" };
  const payment = req.headers.get("x-payment");
  const sig = req.headers.get("payment-signature");
  if (payment) headers["X-PAYMENT"] = payment;
  if (sig) headers["PAYMENT-SIGNATURE"] = sig;

  const res = await callMerchant(kind, headers);
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.reason, merchantStatus: res.status }, { status: 503 });
  }
  return NextResponse.json(res.body, { status: res.status });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (!KINDS.test(kind)) {
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

  // The merchant decoder reads the signed envelope from either header; send both
  // so it works whether it looks for X-PAYMENT or PAYMENT-SIGNATURE.
  const header = Buffer.from(JSON.stringify(payload.envelope)).toString("base64");
  const res = await callMerchant(kind, {
    "X-PAYMENT": header,
    "PAYMENT-SIGNATURE": header,
    "content-type": "application/json",
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.reason, merchantStatus: res.status }, { status: 503 });
  }
  return NextResponse.json(res.body, { status: res.status });
}

export { merchantDownMessage };
