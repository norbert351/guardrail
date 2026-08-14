/**
 * GuardRail Claude client — AgentRouter gateway, Claude only.
 *
 * The gateway (agentrouter.org) is an Anthropic-compatible one-api style
 * relay. Facts that are verified and must not be re-derived:
 *   - base URL has NO /v1:  https://agentrouter.org
 *   - endpoint is {base}/v1/messages
 *   - auth is `Authorization: Bearer <token>` (ANTHROPIC_AUTH_TOKEN), NOT
 *     the x-api-key header
 *   - header `anthropic-version: 2023-06-01` is required
 *   - system messages go in the top-level `system` field, not in messages[]
 *   - max_tokens is required by the gateway
 *   - working model: claude-opus-4-8. Models without a channel in the
 *     default group 503 with "无可用渠道" (claude-opus-4-6/4-7 are dead).
 *
 * Never log, print, or commit the token. It is read from env only.
 */

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeRequest {
  /** System prompt. Sent in the top-level `system` field per Anthropic API. */
  system?: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ClaudeResult {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ClaudeConfig {
  authToken?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export class ClaudeError extends Error {
  constructor(
    readonly status: number,
    readonly kind: "auth" | "model_unavailable" | "rate_limited" | "server" | "network",
    message: string,
    readonly body?: string,
  ) {
    super(message);
    this.name = "ClaudeError";
  }
}

export function claudeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ClaudeConfig {
  const authToken = env.ANTHROPIC_AUTH_TOKEN;
  if (!authToken) {
    throw new ClaudeError(0, "auth", "ANTHROPIC_AUTH_TOKEN is not set");
  }
  return {
    authToken,
    baseUrl: env.ANTHROPIC_BASE_URL ?? "https://agentrouter.org",
    model: env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
  };
}

export class ClaudeClient {
  private readonly authToken: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: ClaudeConfig = claudeConfigFromEnv()) {
    // claudeConfigFromEnv throws when the token is missing, so this is safe.
    const resolved = config.authToken ?? claudeConfigFromEnv().authToken;
    if (!resolved) throw new ClaudeError(0, "auth", "ANTHROPIC_AUTH_TOKEN is not set");
    this.authToken = resolved;
    this.baseUrl = (config.baseUrl ?? "https://agentrouter.org").replace(/\/+$/, "");
    this.model = config.model ?? "claude-opus-4-8";
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  async complete(request: ClaudeRequest): Promise<ClaudeResult> {
    const url = `${this.baseUrl}/v1/messages`;
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? 1024,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (request.system) body.system = request.system;
    if (request.temperature !== undefined) body.temperature = request.temperature;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.authToken}`,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw new ClaudeError(
        0,
        "network",
        `network error calling ${url}: ${(e as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (!response.ok) {
      throw classifyError(response.status, text);
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ClaudeError(0, "server", `non-JSON response from ${url}`, text.slice(0, 500));
    }
    const typed = data as {
      content?: Array<{ type?: string; text?: string }>;
      model?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const content = (typed.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");
    if (!content) {
      throw new ClaudeError(0, "server", `empty content block from ${url}`, text.slice(0, 500));
    }
    return {
      text: content,
      model: typed.model ?? this.model,
      usage: typed.usage
        ? { inputTokens: typed.usage.input_tokens, outputTokens: typed.usage.output_tokens }
        : undefined,
    };
  }
}

function classifyError(status: number, body: string): ClaudeError {
  const raw = body.slice(0, 600);
  // one-api / new-api style 503: model has no available channel in the group.
  if (status === 503 && /无可用渠道|no available channel/i.test(raw)) {
    return new ClaudeError(status, "model_unavailable", `model unavailable on gateway: ${raw}`, body);
  }
  if (status === 401 || status === 403) {
    return new ClaudeError(status, "auth", `auth rejected (${status}): ${raw}`, body);
  }
  if (status === 429) {
    return new ClaudeError(status, "rate_limited", `rate limited (${status}): ${raw}`, body);
  }
  return new ClaudeError(status, "server", `gateway error ${status}: ${raw}`, body);
}
