# GuardRail — Roadmap

Where GuardRail goes next. Everything under **Shipped** is real and verifiable
today; everything below it is *proposed*, and labelled as such. Nothing here
claims a feature is built when it isn't.

The framing: the hackathon proved the spine (agents can only act inside
onchain-enforced limits, and the marketplace cannot list an agent whose session
isn't live). The roadmap is about turning that spine into a marketplace people
actually use — which means real agent traffic, real hires, and a scope layer
that scales past one operator.

---

## Shipped (live on BSC mainnet, chain 56)

- **Scoped-session marketplace** — `list()` reverts `SessionNotLive` unless the
  agent's key is live in the public Altana KeyStore.
- **Four agents, one per required category, all live** — LP Guardian
  (Rebalancing), GridBot (Grid Trading), Yield Router (Yield Optimisation),
  Health Guard (Health Factor). `listingCount = 4`, all `verifyLive = true`.
- **Onchain trust**: `trustScore(id)` (0–100, re-derivable) and
  `scopeAudit(id)` (full declared scope + liveness) in one read.
- **Self-serve listing** (`/list`) — third parties list their own agents from a
  connected wallet; the UI reads the KeyStore live and shows "session live ✓".
- **User-facing control** — an operator sees Pause/Resume + Unlist only on
  their own listings, gated onchain by `OnlyOperator`.
- **Safety proof** (`/api/safety-proof`, rendered on `/agents`) — reasons over
  the *real* allowlist and cap: drain → `UnauthorizedCall`, in-allowlist but
  over cap → `Spend cap exceeded`, in-allowlist under cap → allowed.
- **`/proof` page** — recomputes every onchain claim from chain state at a
  captured block and cross-checks the KeyStore against `scopeAudit().live`,
  with honest verdicts.
- **Data Quality layer** (`/api/quality` + the "Derived from chain state" panel
  on every card) — scope narrowness, verified onchain action count, real gas
  paid, listing age, and a KeyStore-vs-`verifyLive` cross-check, with
  `insufficientHistory` as a first-class honest state.
- **x402 / B402 sell rail** — four paid endpoints at 0.1 $U per report,
  EIP-3009 settlement on mainnet.
- **ERC-8183 hire rail (buyer side)** — five-call atomic job creation + escrow,
  proven in a mainnet fork test, and now **live on mainnet**: job #56774 is
  `FUNDED` with 0.1 $U genuinely held in escrow (expires 2026-09-18).
  Settlement is blocked by protocol design until the provider submits a
  deliverable and the 7-day optimistic dispute window elapses — an early
  `settle()` reverts `NotDecided()` (0x17be5b7b). That is correct protocol
  behaviour, not a failure, and it is why there is a funded job rather than a
  released one on record.
- **ERC-8004 identity** — one identity per agent (1790–1793), linked to
  8004scan from every card.
- **Agent Advantage Report** (`/termix`) — real onchain evidence (settled $U,
  live market APR, real tx hashes + block numbers).

---

## Next (0–3 months): make the marketplace live, not just correct

### 1. Real hire volume and a first independent operator

The honest gap today is that the four agents are all operated by the project
itself, and the recorded hires/ratings come from the operator's own wallet
(which is why every `trustScore` is a uniform 100). Real transactions, but
**self-recorded track record, not external demand**. The next milestone is not
more features — it is **one external operator listing an agent they actually
run**, and hires landing from a wallet we don't control.

- Recruit from the Altana/ERC-8004 builder community; the self-serve `/list`
  flow already exists, so the onboarding path is real.
- Instrument hire → settled-payment → rating as a single funnel and publish it.

### 1b. Table-stakes parity — SHIPPED (11 Sep 2026)

Sweeping the other submissions at audit time showed the lane at ~8+ entries and
three surfaces that had become **expected rather than differentiating**. All
three are now live:

- ✅ **Open ERC-8004 registry read** — `/registry` + `/api/registry` enumerate
  every agent anyone has registered on the mainnet IdentityRegistry. Verified
  discovering third-party agents alongside ours.
- ✅ **MCP server surface** — `/api/mcp` with 5 read-only tools, so an agent
  (not only a human) can query the marketplace. No tool can spend funds.
- ✅ **Produced demo film** — a **narrated** live screencast of the deployed
  product (53s, 720p, in-repo at `docs/demo/guardrail_demo_720p.mp4`), covering
  home → `/agents` grid → safety proof → `/termix`. The voiceover (18 segments,
  full 53s) walks the safety proof out loud — *"watch an agent get blocked" →
  out-of-scope reverts `UnauthorizedCall` → over-cap rejects → only an allowed
  call executes* — and the real deployment URL and onchain tx hashes are visible
  on screen. Verified frame-by-frame as genuine product footage, not slides or
  generated graphics.
- ⏳ **Length extension** — the remaining gap is duration, not substance: 53s
  against a ~2-minute target. Extending it means adding narration over `/verify`
  (portable certificate), `/registry` (open ERC-8004 discovery), `/api/mcp`
  (agent-queryable) and `/proof` (live recompute). Those sections need a fresh
  live screen-record pass plus new narration, so it is deferred rather than
  faked — the same honesty rule that keeps this film real.
- ✅ **Real ERC-8004 identities** — registered on mainnet (345084–345087),
  replacing a set of ids that actually belonged to four other teams.

The differentiator is no longer breadth of surface. It is `/verify`: trust state
**enforced by the registry contract**, **re-derivable from mainnet state**, and
now **portable** as a certificate a third party can check without us.

### 2. Scope templates

Declaring a scope is currently a manual form (allowlist + cap + period).
New operators guess, and a guessed scope is either too wide (unsafe) or too
narrow (agent useless). Ship a small library of **audited scope presets** per
agent type — e.g. "PancakeSwap LP manager: router + WBNB, 0.02 BNB/day,
7-day expiry" — so the safe choice is also the easy one.

### 3. Live settled ERC-8183 jobs — FUNDED JOB SHIPPED (11 Sep 2026)

Job #56774 is live and funded on mainnet: 0.1 $U genuinely held in escrow,
client/provider both `0xa847…be97`, expires 2026-09-18, readable any time via
`tsx demo/src/escrow-status.ts 56774`.

What remains open is **settlement, not escrow**. `settle()` reverts
`NotDecided()` (0x17be5b7b) until the provider submits a deliverable and the
7-day optimistic dispute window elapses. So the honest remaining work is to
run a job through to `RELEASED` with a real third-party provider and surface
each job's full lifecycle in the UI — the funding half is done.

### 4. Contract source verification on BscScan — SHIPPED (11 Sep 2026)

`GuardRailMarketplace` (`0xb7c80f…80d6`) is verified on BscScan via Etherscan V2
(chain 56): solc v0.8.35, source published, and independently confirmed through
the `getSourceCode` API. The verified source is linked from the contract table
in the README.

What remains is broader than this one contract: keep source + build settings
published for **every** deployed contract as the surface grows, so a reviewer
can always diff bytecode against the repo without asking us.

### 5. Volume-tolerant infrastructure

Two known operational limits: BSC public RPCs block `eth_getLogs` (so the
activity feed is derived from recorded tx hashes), and the free-tier merchant
sleeps when idle. Both are fine for a demo and wrong for a product — move to a
logging-capable RPC/paywalled indexer and an always-on merchant.

---

## Later (3–12 months): from marketplace to marketplace infrastructure

### 6. Scope-as-an-API

The registry reads (`verifyLive`, `scopeAudit`, `trustScore`) are useful to
anyone, not just our UI: a wallet, another marketplace, or an agent deciding
whether to transact with a counterparty. Expose them as a public, versioned API
plus an SDK, so third parties can gate their own flows on the same onchain
truth. This is GuardRail's most defensible surface — the trust layer, not the
web page.

### 7. Reputation that resists gaming

`trustScore` is deliberately cheap to compute and hard to fake (70 of 100 points
are liveness + onchain activity), but it is also coarse. Next: time-weighting,
per-window activity, and down-weighting self-dealing — with every input
re-derivable onchain, because a score nobody can independently recompute is
just a number we made up.

### 8. Scope enforcement beyond BNB Chain

The scoped-session model is not BSC-specific; it is a contract-enforced
authority primitive. Multi-chain listing (same agent identity, per-chain scope)
is a natural extension once a second chain has a compatible KeyStore.

### 9. Composable agent-to-agent limits

Today a buyer hires one agent. The harder and more interesting case: an agent
that hires another agent **inside its own budget**, where the sub-agent's scope
is a strict subset of the parent's. That is the primitive that makes autonomous
agent economies safe, and it is why the spend cap was designed as
`(token, limit, period)` rather than "a balance".

---

## Explicitly NOT planned

Kept here so the scope stays honest:

- **Custodial wallets or shared treasuries.** The entire thesis is that the
  agent never holds authority the owner didn't grant and can't revoke. Anything
  that centralises funds contradicts the product.
- **Unbounded approvals for convenience.** Even as a "trusted operator"
  shortcut — that's the Bankr failure mode by another name.
- **A generic LLM-agent framework.** GuardRail is the guardrail layer, not
  another way to write agents. The four built-in agents exist to prove the
  spine, not to become a framework.
- **Profit numbers in the marketing.** No invented APY, no hypothetical
  returns. `trustScore` 40 is the honest baseline until real hires move it.

---

## How to read the status of anything in this file

`docs/TECHNICAL.md` §9 carries the verified-vs-unverified status table, and
`web/app/proof/page.tsx` (`/proof`) recomputes the onchain claims from chain
state at a captured block. If a claim in the README, the pitch or this roadmap
disagrees with `/proof`, trust `/proof`.
