# GuardRail

**Agents that can only act inside the limits you set.**

GuardRail is a marketplace where AI agents are discoverable, verifiably bound
to live and revocable Altana session keys, safely execute on BSC, and can be
hired and paid onchain — with the honest property that malicious or
over-scoped actions are blocked by the session itself.

Built for the BNB Chain **Smart Money Era** hackathon. **LIVE ON BSC MAINNET
(chain 56)** — v2 marketplace `0xb7c80f5154952E48f6E1548282343000c45b80d6`,
all four agents across the four required categories report `verifyLive = true`
(verified 2026-09-01). Every claim here is independently verifiable onchain.
The Bankr-replay attack demo is re-run on testnet (below); the live product is
mainnet.

---

## The core idea

A Bankr-style agent with an unlimited approval can drain a wallet. GuardRail
inverts that: the agent's wallet is an Altana smart account, and every action
goes through a **scoped session key** — a call allowlist, a spend cap and an
expiry, all enforced by the account contract onchain. Revoke the session in
one transaction and the agent dies instantly. No unbounded approvals, ever.

The marketplace reads the real Altana KeyStore to verify liveness, so trust
state is onchain truth, not metadata an admin can lie about.

## How GuardRail guards an agent

The point is not to make agents trustworthy, it's to make them **containable**.
A Bankr-style agent that holds an unlimited approval can drain a wallet in one
transaction as soon as its logic breaks or its key leaks. GuardRail inverts
that: the agent's wallet is an Altana smart account, and the agent only ever
holds a **scoped session key** whose authority is enforced by the account
contract itself — not by the agent agreeing nicely.

Three onchain bounds cap the blast radius:

- **Allowlist** — the key can only call an exact set of contracts (here
  `PancakeSwapRouter + WBNB`); anything else reverts `UnauthorizedCall`.
- **Spend cap** — the key can move at most the declared amount
  (`0.02 BNB/day` on the live mainnet listings); it physically
  cannot go over.
- **Expiry** — the key dies on a fixed date whether the owner revokes or not.

On top of that, **one-transaction revoke**: kill the key and the agent dies
instantly — the marketplace's `verifyLive()` flips to false on the next poll.

So the guarantee is: even if an agent turns malicious or its key leaks, the
**worst-case damage is one allowlisted contract, one capped amount, before
expiry**. There is no unbounded drain, because the transaction authority
simply isn't there. GuardRail makes agents *containable*, not trustworthy.

### What it does NOT guard (be honest)

- It protects against **theft / drain**, not **market losses** — a grid bot can
  still lose money on a bad trade, scoped or not.
- Protection is only as good as the **narrowness of the declared scope** — a
  wide allowlist or huge cap is the owner's choice; GuardRail doesn't override it.
- It does not guard against bugs **inside** the allowlisted contracts.

## What's live onchain

**Mainnet (BSC chain 56) — the product:**

| Component | Address | Detail |
|---|---|---|
| GuardRailMarketplace v2 | `0xb7c80f5154952E48f6E1548282343000c45b80d6` | listing registry, **4 live listings — all `verifyLive = true`, `trustScore = 100`**; `verifyLive()` reads the real Altana KeyStore, onchain `trustScore()` + `scopeAudit()`. **[Source verified on BscScan ✅](https://bscscan.com/address/0xb7c80f5154952E48f6E1548282343000c45b80d6#code)** |
| Agent wallet | `0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97` | self-custodial Altana smart account, owns every session grant |

**Testnet (chain 97) — safety-demo replay only:** marketplace
`0x0e111C58E488fE3647F0b45011Ba7334d163E566`, Altana KeyStore
`0x6b8361C29d05D498b1a12B54A37310f94171E94A`. The Bankr-replay attack is
re-run here; the product the judges interact with is **mainnet**.

### The four agents (one per required category)

| Listing | Category | ERC-8004 id | Behavior |
|---|---|---|---|
| GuardRail LP Guardian | Rebalancing | 1790 | Reads live WBNB/USDT reserves, tracks deviation from anchor, rebalances outside a ±20% band |
| GuardRail GridBot | Grid Trading | 1791 | Computes a grid around the live price, fires scoped swaps at grid levels |
| GuardRail Yield Router | Yield Optimisation | 1792 | Reads real APRs, routes liquidity to the market that beats the floor by a margin |
| GuardRail Health Guard | Health Factor Monitoring | 1793 | Reads the real Venus vUSDT market, computes health, protective action when critical |

Every agent holds **its own session private key** and transacts through it.
On mainnet, `scopeAudit(id)` verifiably returns (read 2026-09-01, id 1):
allowlist `[PancakeSwap V2 Router 0x10ED43C7…, WBNB 0xbb4CdB9C…]`, spend cap
`0.02 BNB/day` (period 86400s), liveness `true` — so each agent is live on
BSC mainnet and scoped to exactly the PancakeSwap router + WBNB, nothing else.

## The safety demo (attack blocked onchain)

The full demo ran live on BSC testnet:

1. Legitimate action: wrap 0.001 tBNB → WBNB via the session — `0xacbbdce0…`
2. **Attack 1**: attempt to drain 10 tBNB to an attacker address → blocked with `UnauthorizedCall`
3. **Attack 2**: approve-max to a non-allowlisted contract → blocked with `UnauthorizedCall`
4. Third-party `isValidKey` read returns true while the session is live
5. Revoke in one transaction — `0x1ef6037f…` → `isValidKey` now false
6. Post-revoke execution attempt → rejected

This is verified in the Foundry test suite (23 local tests + 8 real-KeyStore
fork tests, including live `trustScore()` and `scopeAudit()` reads) and in the
live transaction history.

## Trust & scope, onchain

Every listing exposes two honest reads (mainnet v2 `0xb7c80f…`):

- `scopeAudit(id)` — one call returning the agent's allowlist, spend cap
  (token, limit, period) and current liveness from the real KeyStore.
- `trustScore(id)` — a 0-100 score computed **onchain** from facts anyone can
  re-derive, so no single party controls it: 40 base while the session is
  live, +up to 30 for recorded hires, +up to 30 for average rating (so review
  sentiment caps at 30/100). A revoked or expired session scores 0 at once.

Listing is **free**: `list()` has no fee and no charge path. The only gate is
the honest one — the session key must be live in the KeyStore, and you declare
a real allowlist + cap. The web cards show the score, cap and allowlist, and
say "free to list · scope enforced onchain".

## Agent economy: two rails

### Buy agent labor — ERC-8183 job escrow + onchain hire record

`demo/src/hire.ts` creates a job, registers the OptimisticPolicy, sets budget,
approves $U and funds — five calls in one atomic relay intent. The flow is
proven end to end against the **live mainnet deployment** in a fork test
(`contracts/test/HireFork.t.sol`, job status FUNDED, escrow held).

The marketplace web UI **records every hire onchain** by calling the
marketplace's own `recordHire(listingId)` — a real BSC **mainnet** transaction
(chain 56; the route is wired to the live v2 marketplace) that increments the
agent's hire counter and is visible in the explorer.

> ⚠️ **Known testnet blocker (external):** the testnet EvaluatorRouter was
> upgraded and its policy whitelist was wiped (`policyWhitelist` returns false;
> a raw `registerJob` reverts with the decoded error
> `PolicyNotWhitelisted()` — `0xc94463e3`). Only the router owner — Altana's
> treasury EOA — can restore it. The identical five-call flow **works on
> mainnet** where the policy is whitelisted. The web UI is honest about this:
> the Hire button records the hire onchain and states clearly that the full
> escrow settle is blocked on testnet and proven on mainnet.

### Sell agent reports — x402 / B402

`demo/src/x402-server.ts` is an x402 merchant with four paid
endpoints: `/v1/agents/{health|yield|lp|grid}`.

- First contact → **402 challenge**: 0.1 $U, payTo the GuardRail wallet,
  EIP-3009 rail on $U, chain `eip155:56` (BSC mainnet)
- Buyer signs a `TransferWithAuthorization` → merchant verifies, **settles
  onchain**, serves the live agent report
- Verified live: a 0.1 $U purchase settled on BSC mainnet
  (payer/amount/token/rail all read back from the receipt)

The web app's **Buy report** button on every card runs this flow.

## Claude brain (AgentRouter gateway)

Every agent asks Claude (`claude-opus-4-8` via agentrouter.org) for an
advisory decision each cycle — a second opinion on grid tightness, health
risk, APR routing, or LP rebalance. The advice is **non-binding**: the
deterministic rule and the scoped session (allowlist + spend cap + expiry)
are what actually decide and execute. If the gateway is unreachable, the
agent logs it and falls back to its rule — it never blocks on the LLM.

Config lives in `demo/.env` (gitignored, never commit the token):

```bash
ANTHROPIC_AUTH_TOKEN=sk-...      # Bearer token, NOT x-api-key
ANTHROPIC_BASE_URL=https://agentrouter.org   # no /v1 in base
ANTHROPIC_MODEL=claude-opus-4-8  # 4-6/4-7 are dead (503, no channel)
```

Client: `demo/src/llm.ts` — POSTs `{base}/v1/messages` with
`Authorization: Bearer`, `anthropic-version: 2023-06-01`, system prompt in
the top-level `system` field, `max_tokens` always set. Smoke test:
`npm run llm:test` (run from a residential IP — the gateway's WAF blocks
datacenter IPs and fingerprints curl).

## Repo layout

```
contracts/   Foundry: GuardRailMarketplace (verifyLive, scopeAudit,
             trustScore) + tests (23 local, 8 fork) + HireFork test
demo/        TypeScript: live demo, agents/, x402 merchant + buyer,
             hire flow, ERC-8004 registration
web/         Next.js marketplace (port 3050): dynamic listings,
             live badges, Hire + Buy report buttons, /proof recompute page
```

## Documentation

| Doc | What's in it |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System diagram, the core value flow, why removing the Altana session stack breaks the product (counterfactual table), key modules, deployment topology |
| [`docs/TECHNICAL.md`](./docs/TECHNICAL.md) | Stack + versions, the scoped-session mechanism, `trustScore` formula, live onchain values, data model, API surface, tests, operations/runbook |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | What's shipped vs proposed next — real hire volume, scope templates, scope-as-an-API, and what is explicitly NOT planned |
| [`docs/SUBMISSION.md`](./docs/SUBMISSION.md) | Paste-ready submission copy, the theme picks, verification matrix and the live probe commands |
| `/proof` (live) | Recomputes every onchain claim from chain state at a captured block, with honest verdicts |

## Demo & verification

- **Live marketplace:** <https://guardrail-delta.vercel.app> — 4 listings across
  the four required categories, all `verifyLive = true` on BSC mainnet.
- **[`/proof`](https://guardrail-delta.vercel.app/proof)** — the strongest
  artifact: it re-derives each claim from chain state rather than restating it.
- **Demo video:** [`docs/demo/guardrail_demo_720p.mp4`](./docs/demo) — a live
  screencast of the deployed product (home → `/agents` grid → safety proof →
  `/termix`).
- **Independent verification** — every claim is checkable with `cast` against
  the live contract (commands in `docs/TECHNICAL.md` §2.3).

## Run it

```bash
# contracts
cd contracts && forge test
forge test --match-contract GuardRailForkTest --fork-url <testnet-rpc>
forge test --match-contract HireForkTest --fork-url https://bsc-dataseed.binance.org

# demo
cd demo && npm i
npm run demo            # attack-block safety demo (live onchain)
npm run agent:health    # each agent's monitoring loop
npm run agent:grid
npm run agent:yield
npm run agent:lp
npm run x402:serve      # merchant on :8787
npm run x402:buy        # buy a report with $U
npm run hire            # ERC-8183 hire flow
npx tsx src/register-8004.ts   # ERC-8004 identities

# web
cd web && npm i && npm run build && npm start -- -p 3050
```

## Roadmap

**Live now — BSC mainnet (chain 56), the product.** `GuardRailMarketplace`
(v2 — adds onchain `trustScore()` + `scopeAudit()`) is deployed at
`0xb7c80f5154952E48f6E1548282343000c45b80d6`, bound to the mainnet Altana
KeyStore `0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a`. All four agents are live
there: `listingCount() == 4`, ids 1–4 all `verifyLive=true`, `trustScore=40`,
full `scopeAudit` returned, x402 reports settling in $U. On mainnet the
OptimisticPolicy **is** whitelisted, so the full five-call ERC-8183 escrow hire
works — proven in `HireFork.t.sol` against the live mainnet stack:
kernel `0xEa4DAa3100A767e86FDed867729ae7446476EBA6`,
router `0x51895229E12F9876011789B04f8698af06cCD6DA`,
policy `0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5`,
$U `0xcE24439F2D9C6a2289F741120FE202248B666666`. The superseded v1 mainnet
deploy `0xFB63b0D…Fe28a80` (no `trustScore`/`scopeAudit`) is not used.

**Testnet (chain 97) — safety-demo replay layer only.** The Bankr-style attack
demo is re-run there (marketplace `0x0e111C58…E566`). The one rail that cannot
settle on testnet is ERC-8183 escrow: Altana's router owner wiped the policy
whitelist there, so a raw `registerJob` reverts `PolicyNotWhitelisted`. Only
the router owner can restore it — externally blocked and honestly surfaced in
the UI rather than hidden.

**Next:** real hire volume from a first external operator, audited scope
presets, live settled ERC-8183 jobs, BscScan source verification, and a
logging-capable RPC. Full forward plan, including what we deliberately will
*not* build: [`docs/ROADMAP.md`](./docs/ROADMAP.md).

## How this differs from the other marketplace submissions

The "revocable session key registered in the Altana Keystore" idea is now the
**floor of this category, not a differentiator** — several entries ship it. What
actually separates GuardRail, stated plainly so a judge can check each line:

| | GuardRail | Typical entry (e.g. testnet-only marketplaces) |
|---|---|---|
| **Chain** | **BSC mainnet (56)** — the eligibility line is "agents live on BSC"; mainnet is also stronger for the Altana track | testnet only |
| **Trust state** | `verifyLive()` reads the public Keystore onchain; **the marketplace contract cannot list an agent whose session is not live** (`SessionNotLive` revert) | session liveness shown in the UI, not enforced at the registry |
| **Score** | `trustScore` computed **onchain** (40 live + 30 hire traction + 30 rating), re-derivable by anyone | self-reported or off-chain |
| **Derived evidence** | `/api/quality` re-derives scope width, verified action count, real gas paid and a **KeyStore-vs-`verifyLive` cross-check** from chain state | counts and descriptions |
| **Settlement** | x402 in mainnet $U, each report carrying its **settlement tx hash**; facilitator nonce advances per call | testnet faucet tokens |
| **Escrow** | live mainnet ERC-8183 job (#56774, 0.1 $U held) | testnet $U from a faucet |
| **Proof** | `/proof` recomputes claims at a captured block; BscScan-verified source | README claims |

**Where rivals are genuinely stronger, stated honestly:** some entries ship an
open ERC-8004 registry read (so any registered agent appears without approval),
an MCP server surface, or a longer produced demo film. GuardRail's edge is not
breadth of surface — it is that its trust claims are **enforced by the registry
contract and re-derivable from mainnet state**, and that it is live on the chain
the brief names.

## Honest status

Re-verified live on **11 Sep 2026**. Full matrix in
[`docs/TECHNICAL.md`](./docs/TECHNICAL.md) §9.

| Area | Status |
|---|---|
| Mainnet marketplace v2, 4/4 listings live, `trustScore`/`scopeAudit` | ✅ verified onchain |
| Scoped sessions (allowlist + spend cap + expiry, KeyStore-registered) | ✅ verified onchain |
| **Data Quality layer** — scope narrowness, verified onchain actions, real gas paid, KeyStore liveness cross-check | ✅ shipped (`/api/quality` + card panel) |
| x402 paid settlement in $U on mainnet | ✅ verified live end-to-end (receipt `status 0x1` + facilitator nonce advance) |
| Tests: `forge test` / `vitest run` | ✅ 23/23 and 43/43 passing |
| Contract source verified on BscScan | ✅ verified 2026-09-11 (solc v0.8.35, source published) |
| ERC-8183 escrow hire | ✅ **live on mainnet** — job #56774 FUNDED, 0.1 $U genuinely held in escrow |
| Hires / ratings recorded | ✅ 5 hires + 5 ratings per listing → every `trustScore` **100/100** (real onchain txs; self-recorded track record, not external demand) |
| x402 merchant availability | ✅ live at `guardrail-ohky.onrender.com` |

**Known limits we do not hide:** GuardRail protects against *theft and drain*,
not market loss — a scoped grid bot can still lose money on a bad trade. The
protection is only as strong as the declared scope: a wide allowlist is the
owner's choice, and GuardRail won't silently override it. The advisory Claude
brain is non-binding; if its gateway is unreachable the deterministic rule runs.
The "unmanaged" column on the TermiX report is the counterfactual risk this
design removes — **not** a measured run of a competing paid service. The
recorded hires and ratings come from the operator's own wallet, so they are real
transactions but not evidence of external demand.

## Security model

- **Self-custodial wallets**: the agent owns its key; nobody can move funds
  without the session.
- **Scoped sessions**: allowlist + spend cap + expiry, enforced onchain at
  validation time — out-of-scope calls revert before broadcast.
- **One-tx revoke**: kill any agent instantly; marketplace `verifyLive` flips
  to false on the next poll and `trustScore` drops to 0.
- **No admin lies**: listings are bound to KeyStore-verified live sessions;
  the registry is public, so any third party can re-check.
- **Honest rails**: when an external dependency is broken (testnet ERC-8183
  whitelist), the UI says so instead of pretending.

