/**
 * GuardRail Agent Supervisor Loop
 *
 * Runs all four agents' `--once` checks on a schedule so the marketplace's
 * "live agents" are backed by real, ticking execution — not just static
 * KeyStore sessions. Each tick runs every agent once, captures its output,
 * and appends a timestamped row to a run log that judges can inspect.
 *
 * An agent only broadcasts a scoped-session tx when its own action rule
 * fires (e.g. Health Guard acts below critical health); otherwise a tick is
 * read + advisory. Actions, when they happen, go through the agent's session
 * key and are capped by the onchain allowlist + spend limit.
 *
 * Usage: tsx src/agent-loop.ts [--interval 300] [--log /tmp/guardrail-loop.log]
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const AGENTS = [
  { name: "lp-guardian", listing: 6, script: "src/agents/lp-guardian.ts" },
  { name: "gridbot", listing: 7, script: "src/agents/gridbot.ts" },
  { name: "yield-router", listing: 8, script: "src/agents/yield-router.ts" },
  { name: "health-guard", listing: 9, script: "src/agents/health-guard.ts" },
];

function argValue(flag: string, args: string[], def: string): string {
  const eq = args.find((a) => a.startsWith(flag + "="));
  if (eq) return eq.split("=")[1];
  const i = args.indexOf(flag);
  if (i !== -1 && args[i + 1]) return args[i + 1];
  return def;
}

const INTERVAL_S = Number(argValue("--interval", process.argv, "300")) || 300;
const LOG_FILE = argValue("--log", process.argv, "/tmp/guardrail-loop.log");

const tsxBin = join(process.cwd(), "node_modules", ".bin", "tsx");
const ts = () => new Date().toISOString();

function writeLog(line: string) {
  const dir = LOG_FILE.slice(0, LOG_FILE.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(LOG_FILE, line + "\n");
}

function runAgent(agent: { name: string; listing: number; script: string }): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(tsxBin, [agent.script, "--once"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, out: out + "\n[timeout]" });
    }, 120_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, out: (out || err).trim() });
    });
  });
}

async function tick() {
  const started = ts();
  writeLog(`=== tick ${started} ===`);
  for (const agent of AGENTS) {
    const t0 = Date.now();
    const { ok, out } = await runAgent(agent);
    const ms = Date.now() - t0;
    const last = out.split("\n").filter(Boolean).pop() ?? "";
    const hasTx = /tx|sent|0x[0-9a-f]{40}/i.test(out);
    writeLog(`[${ts()}] ${agent.name} (listing #${agent.listing}) ${ok ? "ok" : "FAIL"} ${ms}ms ${hasTx ? "·ACTION" : ""} | ${last.slice(0, 200)}`);
  }
  writeLog(`=== tick done in ${((Date.now() - new Date(started).getTime()) / 1000).toFixed(1)}s ===`);
}

writeLog(`GuardRail agent supervisor up at ${ts()} — interval ${INTERVAL_S}s. Agents: ${AGENTS.map((a) => `${a.name}#${a.listing}`).join(", ")}`);
console.log(`GuardRail agent supervisor — interval ${INTERVAL_S}s, log ${LOG_FILE}`);

(async () => {
  await tick();
  setInterval(tick, INTERVAL_S * 1000);
})();
