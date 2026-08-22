# GuardRail

**Agents that can only act inside the limits you set.**

GuardRail is a marketplace where AI agents are discoverable, verifiably bound
to live and revocable Altana session keys, safely execute on BSC, and can be
hired and paid onchain — with the honest property that malicious or
over-scoped actions are blocked by the session itself.

Built for the BNB Chain **Smart Money Era** hackathon. Everything below is
live on BSC testnet (chain 97) and independently verifiable onchain.

---

## The core idea

A Bankr-style agent with an unlimited approval can drain a wallet. GuardRail
inverts that: the agent's wallet is an Altana smart account, and every action
goes through a **scoped session key** — a call allowlist, a spend cap and an
expiry, all enforced by the account contract onchain. Revoke the session in
one transaction and the agent dies instantly. No unbounded approvals, ever.

The marketplace reads the real Altana KeyStore to verify liveness, so trust
state is onchain truth, not metadata an admin can lie about.

## What's live onchain

| Component | Address / Id | Detail |
|---|---|---|
| GuardRailMarketplace | `0x0e111C58E488fE3647F0b45011Ba7334d163E566` | listing registry, 4 live listings, `verifyLive()` reads the KeyStore, onchain `trustScore()` + `scopeAudit()` |
| Altana KeyStore | `0x6b8361C29d05D498b1a12B54A37310f94171E94A` | session keys live here; anyone can verify |
| Agent wallet | `0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97` | self-custodial, owns all session grants |

### The four agents (one per required category)

| Listing | Category | ERC-8004 id | Behavior |
|---|---|---|---|
| GuardRail LP Guardian | Rebalancing | 1790 | Reads live WBNB/USDT reserves, tracks deviation from anchor, rebalances outside a ±20% band |
| GuardRail GridBot | Grid Trading | 1791 | Computes a grid around the live price, fires scoped swaps at grid levels |
| GuardRail Yield Router | Yield Optimisation | 1792 | Reads real APRs, routes liquidity to the market that beats the floor by a margin |
| GuardRail Health Guard | Health Factor Monitoring | 1793 | Reads the real Venus vUSDT market, computes health, protective action when critical |

Every agent holds **its own session private key** and transacts through it.
The sessions are capped at 0.02 tBNB/day with an allowlist of exactly
`PancakeSwapRouter + WBNB`.

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

Every listing exposes two honest reads (deployed `0x0e111C58…E566`):

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
marketplace's own `recordHire(listingId)` — a real BSC testnet transaction
that increments the agent's hire counter and is visible in the explorer.

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
  EIP-3009 rail on $U, chain `eip155:97`
- Buyer signs a `TransferWithAuthorization` → merchant verifies, **settles
  onchain**, serves the live agent report
- Verified live: multiple paid purchases settled on testnet

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
             live badges, Hire + Buy report buttons
```

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

**Now — BSC testnet (live demo).** Agents listed, sessions in the testnet
KeyStore, `verifyLive` true, Buy-report (x402) settling, every hire recorded
onchain via `recordHire`. The one rail that can't settle on testnet is the
ERC-8183 escrow, because Altana's router owner wiped the policy whitelist
there — externally blocked, honestly surfaced in the UI.

**Mainnet (partial, done).** `GuardRailMarketplace` is deployed on BSC
mainnet at `0xFB63b0D141eA15E4a3eC33bd2746DA3c4Fe28a80` (tx
`0xbcc57e8c…c05bee9`, verified: mainnet KeyStore + admin set). On mainnet the
OptimisticPolicy **is** whitelisted, so the full five-call ERC-8183 escrow
hire works — proven in `HireFork.t.sol`. Remaining to flip fully mainnet:
register the four agents' sessions in the mainnet KeyStore and list them on
the deployed contract (needs ~0.005–0.01 BNB of gas + mainnet $U for the
escrow), then point the x402 merchant and web at chain 56.

## Security model

- **Self-custodial wallets**: the agent owns its key; nobody can move funds
  without the session.
- **Scoped sessions**: allowlist + spend cap + expiry, enforced onchain.
- **One-tx revoke**: kill any agent instantly; marketplace `verifyLive` flips
  to false on the next poll.
- **No admin lies**: listings are bound to KeyStore-verified live sessions.
- **Honest rails**: when an external dependency is broken (testnet ERC-8183
  whitelist), the UI says so instead of pretending.
