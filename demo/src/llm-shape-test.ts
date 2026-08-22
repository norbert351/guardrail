/**
 * Request-shape test for the Claude client — no network.
 * Mocks fetch, asserts the exact wire contract:
 *   - URL = {base}/v1/messages (base has no /v1)
 *   - Authorization: Bearer <token> (never x-api-key)
 *   - anthropic-version: 2023-06-01
 *   - system in the TOP-LEVEL field, not inside messages[]
 *   - max_tokens always present
 * Usage: npx tsx src/llm-shape-test.ts
 */
import { ClaudeClient } from "./llm.js";

let captured: { url: string; headers: Record<string, string>; body: unknown } | undefined;

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  captured = {
    url: String(input),
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: JSON.parse(String(init?.body ?? "{}")),
  };
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text: "OK" }],
      model: "claude-opus-4-8",
      usage: { input_tokens: 5, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as typeof fetch;

async function main() {
  const client = new ClaudeClient(
    { authToken: "sk-test-token", baseUrl: "https://agentrouter.org", model: "claude-opus-4-8" },
  );
  (globalThis as Record<string, unknown>).fetch = fakeFetch;

  const result = await client.complete({
    system: "You are a test.",
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 32,
    temperature: 0.2,
  });

  if (!captured) throw new Error("fetch never called");
  const errors: string[] = [];
  if (captured.url !== "https://agentrouter.org/v1/messages") errors.push(`URL wrong: ${captured.url}`);
  if (captured.headers.authorization !== "Bearer sk-test-token") errors.push(`auth wrong: ${captured.headers.authorization}`);
  if (captured.headers["anthropic-version"] !== "2023-06-01") errors.push(`anthropic-version wrong: ${captured.headers["anthropic-version"]}`);
  if (captured.headers["x-api-key"]) errors.push("x-api-key present — must use Bearer only");
  const body = captured.body as Record<string, unknown>;
  if (body.system !== "You are a test.") errors.push("system not top-level");
  if ((body.messages as Array<{ role: string }>).some((m) => m.role === "system")) errors.push("system inside messages[]");
  if (body.max_tokens !== 32) errors.push(`max_tokens wrong: ${body.max_tokens}`);
  if (body.model !== "claude-opus-4-8") errors.push(`model wrong: ${body.model}`);
  if (result.text !== "OK") errors.push(`result text wrong: ${result.text}`);

  if (errors.length) {
    console.error("FAIL:");
    errors.forEach((e) => console.error("  - " + e));
    process.exit(1);
  }
  console.log("PASS: URL, Bearer auth, anthropic-version, top-level system, max_tokens, model all correct");
  console.log(`payload: ${JSON.stringify(body)}`);
}

main().catch((e) => {
  console.error("FAIL:", String((e as Error)?.message ?? e));
  process.exit(1);
});
