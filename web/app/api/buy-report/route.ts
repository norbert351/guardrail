import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * POST /api/buy-report
 * Body: { kind: "health" | "yield" | "lp" | "grid" }
 *
 * Buys a GuardRail agent report over x402: runs the tested EOA buyer against
 * the merchant, which negotiates the 402 challenge, signs an EIP-3009
 * TransferWithAuthorization in $U, and gets the paid report back. The
 * settlement is real onchain BSC testnet state.
 *
 * Returns { ok, receipt?, report?, error? }.
 */
export async function POST(req: Request) {
  let body: { kind?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const kind = body.kind;
  if (!kind || !/^(health|yield|lp|grid)$/.test(kind)) {
    return NextResponse.json({ ok: false, error: "kind must be health|yield|lp|grid" }, { status: 400 });
  }

  const merchantUrl = process.env.GUARDRAIL_MERCHANT_URL ?? "http://127.0.0.1:8787";

  try {
    const { stdout, stderr } = await execFileP(
      "npx",
      ["tsx", "src/x402-buy.ts", `${merchantUrl}/v1/agents/${kind}`],
      {
        cwd: "/home/ubuntu/guardrail/demo",
        timeout: 90_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const output = stdout + (stderr ? `\n[stderr] ${stderr}` : "");
    const ok = output.includes("status: 200");

    // Extract the paid receipt from the buyer's JSON output.
    const receiptMatch = output.match(/PAID\. receipt: (\{.*\})/s);
    let receipt: unknown;
    if (receiptMatch) {
      try {
        receipt = JSON.parse(receiptMatch[1]);
      } catch {
        receipt = undefined;
      }
    }
    const reportMatch = output.match(/report head: ([\s\S]*?)(?=\n\[|\n$|$)/);
    const report = reportMatch?.[1] ?? output;

    return NextResponse.json({
      ok,
      receipt,
      report: report.slice(0, 2000),
      output: output.slice(0, 3000),
      error: ok ? undefined : output.slice(0, 1200),
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const detail = (err.stderr ?? err.stdout ?? err.message ?? String(e)).slice(0, 1500);
    return NextResponse.json({ ok: false, error: detail });
  }
}
