/**
 * GuardRail LLM smoke test.
 *
 * Verifies the AgentRouter Claude wire end to end WITHOUT printing the token:
 *   - builds the client from demo/.env (ANTHROPIC_AUTH_TOKEN / BASE_URL / MODEL)
 *   - sends a minimal messages call with a system prompt
 *   - prints the reply text and model, or the failure class.
 *
 * NOTE: agentrouter.org fingerprints curl and its WAF blocks datacenter IPs.
 * From this VM you will typically see a network/WAF failure even with a valid
 * key. Run from a residential IP (the user's machine) for a real pass.
 *
 * Usage: npm run llm:test
 */
import { ClaudeClient, ClaudeError, claudeConfigFromEnv } from "./llm.js";
import { loadEnv } from "./agents/lib.js";

async function main() {
  loadEnv();
  const cfg = claudeConfigFromEnv();
  // Never print the token.
  console.log(`base ${cfg.baseUrl}, model ${cfg.model}, token set: ${Boolean(cfg.authToken)}`);

  const client = new ClaudeClient(cfg);
  const result = await client.complete({
    system: "Reply with exactly: OK",
    messages: [{ role: "user", content: "Confirm the wire works." }],
    maxTokens: 16,
  });
  console.log(`reply: ${result.text}`);
  console.log(`model: ${result.model}`);
  if (result.usage) console.log(`tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
}

main().catch((e) => {
  if (e instanceof ClaudeError) {
    console.error(`ClaudeError kind=${e.kind} status=${e.status}: ${e.message}`);
  } else {
    console.error(String((e as Error)?.stack ?? e));
  }
  process.exit(1);
});
