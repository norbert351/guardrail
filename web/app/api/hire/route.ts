import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// Resolve the GuardRail demo dir (agent scripts + session keys). Render
// clones the repo with rootDir=web, so demo/ is a sibling of web/.
function demoDir(): string {
  return process.env.GUARDRAIL_DEMO_DIR ?? join(process.cwd(), "..", "demo");
}
function demoBin(): string {
  return join(demoDir(), "node_modules", ".bin", "tsx");
}

/**
 * POST /api/hire
 * Body: { provider: string, task?: string, budget?: number }
 *
 * Runs the GuardRail ERC-8183 hire flow (the tested demo/src/hire.ts script)
 * against BSC testnet. The buyer is the GuardRail admin wallet, whose key
 * lives in the demo state file on this server — the same wallet that owns the
 * marketplace listings, so hiring a listed agent escrows $U against the very
 * wallet the marketplace card advertises.
 *
 * Returns { ok, jobId?, tx?, output?, error? }. When the chain rejects the
 * job (e.g. the testnet ERC-8183 router's policy whitelist is currently
 * empty after an upgrade), the raw error is surfaced so the UI can show the
 * honest status instead of a fake success.
 */
export async function POST(req: Request) {
  let body: { provider?: string; task?: string; budget?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const provider = body.provider;
  if (!provider || !/^0x[a-fA-F0-9]{40}$/.test(provider)) {
    return NextResponse.json({ ok: false, error: "provider must be a 0x address" }, { status: 400 });
  }

  const task = body.task ?? "Hire this GuardRail agent for a scoped onchain task.";
  const budget = typeof body.budget === "number" && body.budget > 0 ? body.budget : 0.1;

  if (!existsSync(demoBin())) {
    return NextResponse.json(
      { ok: false, error: "agent demo not installed on this host (GUARDRAIL_DEMO_DIR missing node_modules/.bin/tsx)" },
      { status: 501 },
    );
  }

  try {
    const { stdout, stderr } = await execFileP(
      demoBin(),
      ["src/hire.ts", provider, task, String(budget)],
      {
        cwd: demoDir(),
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const output = stdout + (stderr ? `\n[stderr] ${stderr}` : "");
    // Parse the script's key facts for a structured response.
    const jobIdMatch = output.match(/jobId: (\d+)/);
    const statusMatch = output.match(/job #\d+ status: (\w+)/);
    const txMatch = [...output.matchAll(/https:\/\/testnet\.bscscan\.com\/tx\/(0x[a-fA-F0-9]{64})/g)];
    const ok = output.includes("Hire flow complete") || statusMatch?.[1] === "FUNDED";

    return NextResponse.json({
      ok,
      jobId: jobIdMatch ? Number(jobIdMatch[1]) : undefined,
      status: statusMatch?.[1],
      txs: txMatch.map((m) => m[1]),
      output: output.slice(0, 3000),
      error: ok ? undefined : output.slice(0, 1200),
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const detail = (err.stderr ?? err.stdout ?? err.message ?? String(e)).slice(0, 1500);
    return NextResponse.json({ ok: false, error: detail, output: detail });
  }
}
