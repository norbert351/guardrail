/**
 * GuardRail x402 sell rail — MAINNET variant (chain 56).
 * Same flow as x402-server.ts but settles on BSC mainnet in mainnet $U
 * (0xcE24...6666). For the on-chain self-pay demo / mainnet submission proof.
 * Usage: tsx src/x402-server-mainnet.ts [--port 8788]
 */
import { createServer } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { parseEther } from "viem";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { U_TOKEN, createX402Merchant } from "@altananetwork/x402-server";
import { BNB } from "@altananetwork/sdk";

const WALLET = "0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97" as `0x${string}`;
const PRICE_U = parseEther("0.1");

function loadAdminKey(): `0x${string}` {
  if (process.env.GUARDRAIL_ADMIN_KEY) return process.env.GUARDRAIL_ADMIN_KEY as `0x${string}`;
  const f = join(process.cwd(), ".guardrail-state.json");
  if (!existsSync(f)) throw new Error("no .guardrail-state.json (set GUARDRAIL_ADMIN_KEY)");
  return JSON.parse(readFileSync(f, "utf8")).adminKey as `0x${string}`;
}

const merchant = createX402Merchant({
  chainId: BNB.chainId,
  payTo: WALLET,
  price: PRICE_U,
  minPrice: parseEther("0.01"),
  maxPrice: parseEther("1"),
  rails: [{ rail: "eip3009", token: U_TOKEN[56] }],
  description: "GuardRail agent capability report (health / yield / LP / grid)",
  resource: { url: "https://guardrail.local/v1/agents", mimeType: "application/json" },
  facilitator: privateKeyToAccount(loadAdminKey()),
  rpcUrl: BNB.publicRpcUrl,
  chain: BNB.chain,
});

const PORT = Number(process.argv.find((a) => a.startsWith("--port"))?.split("=")[1] ?? 8788);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

async function agentReport(kind: string): Promise<string> {
  const script =
    kind === "health"
      ? "src/agents/health-guard.ts"
      : kind === "yield"
        ? "src/agents/yield-router.ts"
        : kind === "lp"
          ? "src/agents/lp-guardian.ts"
          : "src/agents/gridbot.ts";
  const { execFileSync } = await import("node:child_process");
  try {
    const tsxBin = join(process.cwd(), "node_modules", ".bin", "tsx");
    const out = execFileSync(tsxBin, [script, "--once"], {
      cwd: process.cwd(),
      timeout: 120_000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return err.stdout || err.stderr || String(e);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;

  if (path === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, merchant: WALLET, priceU: "0.1", chainId: 56 }));
    return;
  }

  const m = path.match(/^\/v1\/agents\/(health|yield|lp|grid)$/);
  if (!m) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  const kind = m[1];

  const paymentHeader = req.headers["x-payment"] as string | undefined;
  const guardResult = await merchant.requirePayment(paymentHeader ?? null);
  if (guardResult.status === 402) {
    res.writeHead(402, { "content-type": "application/json" });
    res.end(JSON.stringify(guardResult.body));
    return;
  }

  const receipt = guardResult.receipt!;
  const report = await agentReport(kind);
  const body = {
    agent: kind,
    listing: `GuardRail ${kind} agent`,
    paid: {
      payer: receipt.payer,
      amount: receipt.amount.toString(),
      token: receipt.token,
      rail: receipt.rail,
      chainId: 56,
    },
    report,
  };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
});

server.listen(PORT, () => {
  console.log(`GuardRail x402 MAINNET merchant listening on :${PORT}`);
  console.log(`payTo ${WALLET}, price 0.1 mainnet $U per report, chain 56`);
  console.log(`endpoints: /v1/agents/{health|yield|lp|grid}`);
});