# GuardRail — Architecture

How GuardRail actually works, and why the Altana scoped-session layer is the
spine (remove it and there is no product, not a degraded one).

- **Live product (BSC mainnet, chain 56):** <https://guardrail-delta.vercel.app>
- **Live x402 merchant (BSC mainnet):** `https://guardrail-nxzi.onrender.com`
  (API host — see the "Marketplace URL vs merchant URL" note below)
- **Marketplace contract (v2):** `0xb7c80f5154952E48f6E1548282343000c45b80d6`
- **Altana KeyStore (mainnet):** `0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a`

## 1. System diagram

```
                        ┌─────────────────────────────────────────────┐
                        │   Buyer / judge (browser)                    │
                        │   guardrail-delta.vercel.app                 │
                        └───────────────┬─────────────────────────────┘
                                        │
                  ┌─────────────────────▼──────────────────────┐
                  │  web/  — Next.js 16 marketplace (Vercel)    │
                  │  • /            marketing + live category    │
                  │  • /agents      listing grid (onchain reads) │
                  │  • /list        self-serve listing (wallet)  │
                  │  • /proof       recompute every claim        │
                  │  • /termix      Agent Advantage Report       │
                  │  • /api/*       server routes → chain/x402   │
                  └───────┬───────────────────────┬──────────────┘
                          │                       │
       onchain reads      │                       │  /api/x402/{kind} proxy
   (viem readContract)    │                       │  (402 challenge → sign)
                          │                       ▼
                          │            ┌──────────────────────────────┐
                          │            │ demo/ x402 merchant (Render) │
                          │            │ /v1/agents/{health|yield|    │
                          │            │   lp|grid}  — 0.1 $U / call  │
                          │            │ EIP-3009 settle on chain 56  │
                          │            └───────────┬──────────────────┘
                          │                        │ settles $U
                          ▼                        ▼
        ┌────────────────────────────────────────────────────────────┐
        │  BSC MAINNET (chain 56)                                     │
        │                                                             │
        │  GuardRailMarketplace v2  0xb7c80f…80d6                     │
        │    list() gated on isValidKey()  ──┐                        │
        │    verifyLive(id)                  │ reads                  │
        │    scopeAudit(id)                  │                        │
        │    trustScore(id)   (computed onchain, 0–100)              │
        │                                    ▼                        │
        │  Altana KeyStore  0x6572427E…7E0a                          │
        │    isValidKey(wallet, keyId) → bool   ← THE SPINE          │
        │    (allowlist · spend cap · expiry, enforced by contract)   │
        │                                                             │
        │  ERC-8004 registry 0x8004A8…BD9e  (agent identity 1790–93) │
        │  $U United Stables 0xcE24…6666    (x402 settlement token)  │
        └────────────────────────────┬───────────────────────────────┘
                                     │ executes inside session
                                     │ (allowlist + cap + expiry)
                          ┌──────────▼──────────────────────────┐
                          │  demo/src/agents/*  — 4 agent brains │
                          │  LP Guardian · GridBot ·             │
                          │  Yield Router · Health Guard         │
                          │  each holds its OWN session key      │
                          └──────────────────────────────────────┘
```

## 2. The core value flow (the spine, made visible)

Everything a user does funnels through one contract-enforced question:
**is this agent's session key still live, and is the requested call inside its
declared scope?**

```
 1. Owner grants a scoped session      →  Altana KeyStore (allowlist, cap, expiry)
 2. Agent is listed on the marketplace →  list() REVERTS unless
                                          IKeyStore.isValidKey(agentWallet, keyId)
 3. Buyer opens /agents                →  web reads listingCount + listingSummary
                                          + verifyLive() + trustScore() per id
 4. Buyer hires / buys a report        →  recordHire(id) onchain  /  x402 402→settle
 5. Agent acts onchain                 →  every call validated by the account contract
                                          out-of-scope → UnauthorizedCall (no broadcast)
                                          over-cap     → Spend cap exceeded
 6. Owner revokes (one tx)             →  isValidKey → false
                                          verifyLive(id) → false, trustScore → 0
```

Step 2 is the load-bearing one. It is not a UI filter and not metadata an
operator can edit — the marketplace contract literally cannot register an agent
whose session is not live in the public Altana KeyStore.

## 3. After removing the Altana session stack | What happens

This is the counterfactual a judge should read first. "Altana session stack" =
the KeyStore + the scoped session key + `isValidKey` enforcement.

| Consumer / feature | What happens without the Altana session stack |
|---|---|
| `list()` (the marketplace's only write entry point) | **Reverts `SessionNotLive`.** There is no way to register an agent — the marketplace has no other listing path. The product does not exist. |
| `verifyLive(id)` | Meaningless — there is no authority registry to read. Every card's liveness badge has no source. |
| `scopeAudit(id)` | Returns nothing. The allowlist / spend cap / expiry shown to buyers are exactly the session's terms; without sessions there is no scope to audit. |
| `trustScore(id)` | Collapses: 40 of the 100 points are "session is live", and a non-live session scores **0**, so every listing would show 0. |
| `/proof` page | Has nothing to recompute — its whole job is cross-checking KeyStore `isValidKey` against `scopeAudit().live`. |
| Safety proof ("watch an agent get blocked") | The `UnauthorizedCall` / cap reverts **are** session enforcement. Remove sessions and there is no bound to demonstrate; the attack would simply succeed. |
| x402 report serving | Still runs, but the paid output is an agent that can act unboundedly — i.e. exactly the Bankr failure mode GuardRail exists to prevent. The reports would be worthless as a trust product. |
| Agent brains (`demo/src/agents/*`) | Cannot execute: `client.execute({session, calls})` needs a granted session. |
| Continuum recall-then-rule gate | **Soft by design, solo-safe.** It is an additive memory amplifier: if Continuum is unreachable the onchain verdict still stands (`recallPriorDenial` returns null by design). Removing it degrades *recall*, not safety. |

**Verdict:** the Altana integration is at the ceiling — the core product cannot
run without it. It is not a settings toggle, not a front-door check, and not
applied once at setup: every listing, every liveness badge, every scope audit
and every onchain execute is resolved through the session.

## 4. Why the session cannot be faked

- Sessions are registered in a **public onchain registry** (the Altana
  KeyStore). Anyone — a judge, another app, a rival agent — can call
  `isValidKey(wallet, keyId)` and get the authoritative answer.
- GuardRail reads that registry **at request time** on every API route
  (`/api/listings`, `/api/stats`, `/api/safety-proof`, `/proof`), so trust
  state is chain truth, not a cache an admin can back-date.
- Revocation is **one transaction and immediate**; the very next poll flips the
  listing to dead and the score to zero.
- The three bounds are enforced by the **account contract**, not by the agent's
  good behaviour: allowlist → `UnauthorizedCall`; spend cap → `Spend cap
  exceeded`; expiry → key dies with no action required.

## 5. Key modules

| Path | What it does |
|---|---|
| `contracts/src/GuardRailMarketplace.sol` | The registry. `list()` gated on `IKeyStore.isValidKey`; `verifyLive`, `scopeAudit`, `trustScore`; operator controls (`toggleActive`, `unlist`); ratings + hire counts. |
| `contracts/script/Deploy.Mainnet.s.sol` | Binds the mainnet KeyStore and deploys the v2 marketplace. |
| `contracts/test/` | 23 local tests + fork suites (`GuardRailForkTest`, `HireForkTest`) that read the **live** deployed contracts. |
| `demo/src/provision-agents-mainnet.ts` | Grants 4 scoped sessions on the mainnet KeyStore via the Altana relay (idempotent on session grant). |
| `demo/src/list-mainnet-direct.ts` | Lists the 4 agents directly from the operator EOA (cheap; sessions already live). |
| `demo/src/agent-act-mainnet.ts` | The thesis in one script: a within-scope call succeeds; an out-of-scope call reverts `UnauthorizedCall` at validation. |
| `demo/src/x402-server-mainnet.ts` | The x402/B402 merchant: 402 challenge → EIP-3009 settle in $U on chain 56 → serve the live agent report. |
| `demo/src/hire.ts` / `contracts/test/HireFork.t.sol` | ERC-8183 job escrow (buyer side), proven against the live mainnet stack. |
| `demo/src/agents/*` | The four agent brains (one per required category), each with its own session key. |
| `web/lib/guardrail.ts` | Chain + address + ABI config for the web app (`GUARDRAIL_CHAIN_ID`/`_KEYSTORE`/`_MARKETPLACE`, mainnet defaults). |
| `web/lib/continuum.ts` | The Continuum day-one-consumer client (plain HTTP; best-effort, never blocks the onchain gate). |
| `web/app/proof/page.tsx` | **`/proof`** — re-derives every onchain claim from chain state at a captured block, with honest verdicts. |
| `web/app/api/*` | Server routes: `listings`, `stats`, `activity`, `agent-metrics`, `safety-proof`, `x402/{kind}`, `hire`, `hire/status`. |

## 6. Deployment topology

| Layer | Host | Notes |
|---|---|---|
| Marketplace UI + API routes | **Vercel** (`guardrail-delta.vercel.app`), rootDir `web` | Next.js 16. Env: `GUARDRAIL_MERCHANT_URL`, `GUARDRAIL_ADMIN_KEY`, optional `BNB_RPC_URL`. OG origin self-resolves via `VERCEL_PROJECT_PRODUCTION_URL`. |
| x402 merchant + agent supervisor | **Render** (`guardrail-nxzi.onrender.com`), rootDir `demo` | A persistent port-binding server that signs settlements — it cannot run on Vercel serverless. Env: `GUARDRAIL_ADMIN_KEY`, `GUARDRAIL_AGENT_KEYS` (JSON of the **mainnet** key file), `GUARDRAIL_NETWORK=mainnet`, `BNB_RPC_URL`. Free tier idles; keep-alive cron required. |
| Contracts | BSC mainnet (chain 56) | Deployed via Foundry script. |
| Chain reads | `https://bsc-dataseed.bnbchain.org` | Note: BSC public RPCs block `eth_getLogs`, so the activity feed derives from recorded tx hashes via `getTransaction` + `getBlock` instead. |

> **Marketplace URL vs merchant URL.** Always submit/test the marketplace URL
> (`guardrail-delta.vercel.app`). The merchant host returns JSON
> (`{"error":"not found"}` on `/`) and is an API backend, not a UI.

## 7. Known constraints (by design or external)

- **Testnet ERC-8183 escrow is externally blocked** — Altana's testnet
  OptimisticPolicy whitelist was wiped (`PolicyNotWhitelisted`). Only the
  router owner can restore it. Mainnet works and is proven in `HireFork.t.sol`.
  The product is mainnet; testnet is the attack-replay layer only.
- **Claude advisory brain** (`claude-opus-4-8` via agentrouter.org) is
  WAF-blocked from datacenter IPs; agents log the failure and fall back to
  their deterministic rule. It is explicitly non-binding.
- **Render free tier sleeps on idle** — hence the keep-alive cron. A judge
  hitting a cold merchant sees a delayed first request, and a *suspended*
  merchant sees a dead Buy button (see `docs/TECHNICAL.md` §Operations).
