# GuardRail — Submission Pack

Paste-ready answers for the BNB Chain **"The Smart Money Era: Build the Era"**
submission form, plus the verification matrix and live probes a judge can run.
Locked during the pre-submission audit on **2 Sep 2026**; state re-verified
**10 Sep 2026**.

- **Event:** The Smart Money Era: Build the Era — BNB Chain
- **Window:** 5 Aug – 9 Sep 2026 (UTC+0) — **closed; now in judging**
- **Prize pool:** $30,000 USD main track + partner bounties (TermiX $10k,
  Best Built with Altana 50,000 XP, PancakeSwap)
- **Submission target:** the GuardRail marketplace

---

## 1. Field values

| Field | Value |
|---|---|
| Project name | GuardRail |
| One-line pitch | Agents that can only act inside the limits you set. |
| Repo | `https://github.com/norbert351/guardrail` (public) |
| Live URL (main) | `https://guardrail-delta.vercel.app` |
| Demo video | `docs/demo/guardrail_demo_720p.mp4` in-repo (53s, 720p) — also publishable to YouTube/X |
| Prototype stage | Working MVP |
| BSC / EVM | Advanced |
| Sub-prize tracks | PancakeSwap + TermiX |
| Prize wallet | The user's **personal** wallet (kept separate from the project/agent wallet `0xa847…5be97`) |
| Mentorship | Yes |

> ⚠️ **Never submit the merchant host** (`guardrail-nxzi.onrender.com`) as the
> main URL. It is the x402 API backend: `/` returns `{"error":"not found"}`.
> A judge clicking it sees a JSON error. The UI is the Vercel URL.

## 2. Description (~780 chars, under the 800-char cap)

> GuardRail is an agent marketplace where every listed agent is bound to a live,
> revocable Altana session key with onchain-enforced limits — a call allowlist, a
> spend cap and an expiry. `list()` reverts unless the key is live in the public
> KeyStore, so trust state is chain truth, not admin metadata. Out-of-scope calls
> revert `UnauthorizedCall` at validation, before broadcast. Four agents, one per
> required category (rebalancing, grid, yield, health factor), are live on BSC
> mainnet with onchain `verifyLive`, `scopeAudit` and a re-derivable
> `trustScore`. Agents sell reports over x402 settled in $U and can be hired via
> ERC-8183 escrow.

## 3. Theme / category pick

Primary: **Main Track — Build the BNB Agent Studio Marketplace**.

Why: the spine IS the category. The marketplace's only write path is gated on a
live, scoped session, so the product is a marketplace *of contained agents* —
not a listing page with a security badge bolted on.

## 4. Required: Agent Advantage Report (TermiX)

TermiX requires ≥3 real tasks run both ways (with an agent hired through the
marketplace vs without), reporting time, cost and output quality, with actual
outputs attached — and at least one task from trading, stock or security.

The in-product report lives at **`/termix`** and is driven by live onchain
data (`/api/stats` settled $U + hires, `/api/agent-metrics` real market APR,
`/api/activity` real tx hashes with block numbers and BscScan links).

| Task | With the agent (via marketplace) | Without | Category |
|---|---|---|---|
| Health-factor check on a Venus vUSDT position | Reads the live market and returns health + protective action, settled 0.1 $U | Manual: open market, compute ratio by hand, decide | **security / risk** |
| LP range review for WBNB/USDT | Reads live reserves, reports deviation vs anchor and whether to rebalance | Manual reserve lookup + deviation math | trading |
| Yield route across markets | Reads live APRs and reports the route beating the floor | Manual APR comparison across venues | trading |

Honest note: the *cost* and *time* columns are real (0.1 $U per report, read
straight from the settlement receipt); the "without" baseline is a manual
workflow, not a competing paid service. The report is meant to show the labor
comparison, not a benchmark against a rival product.

## 5. PancakeSwap Challenge

The four live agents are scoped to exactly the **PancakeSwap V2 Router**
(`0x10ED43C718714eb63d5aA57B78B54704E256024E`) + **WBNB**
(`0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`) — verifiable in one call:

```bash
cast call 0xb7c80f5154952E48f6E1548282343000c45b80d6 \
  "scopeAudit(uint256)(address,bytes32,address,uint256,uint256,address[],bool,bool)" 1 \
  --rpc-url https://bsc-dataseed.bnbchain.org
```

The LP Guardian tracks WBNB/USDT deviation and rebalances outside a ±20% band;
GridBot computes grid levels around the live price and fires scoped swaps.
Both can only ever touch the allowlisted PancakeSwap contracts, capped at
0.02 BNB/day — user funds can't be put at risk beyond the declared cap.

## 6. Best Built with Altana — qualification checklist

| Requirement | Status |
|---|---|
| Live onchain transactions on BSC (testnet or mainnet) | ✅ mainnet, chain 56 |
| Agents on their own Altana wallets | ✅ `0xa847…5be97`, self-custodial smart account |
| Sessions with real limits (allowlist, spend cap, expiry) | ✅ `scopeAudit(1)` returns all three |
| Sessions registered in the Keystore, readable onchain | ✅ public registry `0x6572427E…7E0a` |
| Real onchain transactions through a session key | ✅ `agent-act-mainnet.ts` (within-scope success; out-of-scope `UnauthorizedCall`) |
| User-facing control: see scope + revoke in-product | ✅ cards surface scope; `/agents` safety-proof; operator-only Pause/Unpause/Unlist |
| Bonus: hire via ERC-8183 | ✅ buyer side, proven in `HireFork.t.sol` |
| Bonus: sell over x402/B402 | ✅ `@altananetwork/x402-server`, 0.1 $U per report |

Wallet addresses to include in the submission:
**agent wallet** `0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97`,
**marketplace** `0xb7c80f5154952E48f6E1548282343000c45b80d6`.

## 7. Step-by-step replication guide

```bash
# 1. Clone
git clone https://github.com/norbert351/guardrail && cd guardrail

# 2. Contracts — build + tests (23 local pass)
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts && forge test

# 3. Read the live mainnet state (no keys, no gas)
MK=0xb7c80f5154952E48f6E1548282343000c45b80d6
RPC=https://bsc-dataseed.bnbchain.org
cast call $MK "listingCount()(uint256)" --rpc-url $RPC          # 4
cast call $MK "verifyLive(uint256)(bool)" 1 --rpc-url $RPC      # true
cast call $MK "trustScore(uint256)(uint256)" 1 --rpc-url $RPC   # 40

# 4. Web tests
cd ../web && npm i && npx vitest run                            # 14 pass

# 5. Or just open the live product
open https://guardrail-delta.vercel.app          # marketplace
open https://guardrail-delta.vercel.app/proof    # recomputed onchain claims
```

Env var **names** needed to run the full stack locally (no real secrets in the
repo): `GUARDRAIL_ADMIN_KEY`, `GUARDRAIL_AGENT_KEYS`, `GUARDRAIL_NETWORK=mainnet`,
`BNB_RPC_URL`, `GUARDRAIL_MERCHANT_URL`. See `docs/TECHNICAL.md` §7.1.

## 8. Verification matrix (honest)

| Claim | Verified how | Verdict |
|---|---|---|
| 4 listings live on BSC mainnet | `listingCount()=4`, `verifyLive(1..4)=true` with `cast`, 10 Sep | ✅ VERIFIED |
| Sessions carry allowlist + cap + expiry | `scopeAudit(1)` → PancakeSwap+WBNB, 0.02 BNB/day, 86400s | ✅ VERIFIED |
| `trustScore` is onchain | `trustScore(1)=40` read from the contract | ✅ VERIFIED |
| Liveness is real, not cached | `/api/quality` reads the KeyStore `isValidKey` and cross-checks it against `verifyLive` → `agree: true` | ✅ VERIFIED |
| `list()` is gated on a live session | `contracts/src/GuardRailMarketplace.sol` reverts `SessionNotLive`; covered by `test_ListWithLiveSession` | ✅ VERIFIED |
| Out-of-scope call blocked | `demo/src/agent-act-mainnet.ts` + Foundry tests (`UnauthorizedCall`) | ✅ VERIFIED |
| x402 settles in $U on mainnet | live 402→200 with receipt `{payer, 0.1e18, $U, eip3009}` | ✅ VERIFIED |
| 7 recorded onchain txs are real | each re-fetched per request: status success, real block + gas | ✅ VERIFIED |
| ERC-8183 escrow hire | mainnet fork test `HireFork.t.sol` (FUNDED, escrow held) | ⚠️ PROVEN-IN-FORK (no live settled job on record) |
| Contract source verified on BscScan | `contracts/verify-bscscan.sh` staged; needs an Etherscan API key | ❌ BLOCKED (key only) |
| Hires / ratings > 0 | `/api/stats` reads 0; `recordHire` simulates OK but wallet holds ~0.000025 BNB vs ~0.0000335 BNB gas | ❌ NONE YET (needs wallet top-up) |
| Merchant reachable during judging | `curl /healthz` returned the Render "Service Suspended" page | ❌ BLOCKED (needs dashboard re-activation) |

## 9. Known constraints (state honestly if asked)

- **Testnet ERC-8183 escrow is externally blocked** — Altana's router owner
  wiped the testnet policy whitelist (`PolicyNotWhitelisted`). Only the owner
  can restore it. Mainnet works, proven in a fork test.
- **Claude advisory brain** is WAF-blocked from datacenter IPs; agents fall back
  to their deterministic rule and never block.
- **Render free tier** sleeps on idle; a suspended service needs dashboard
  re-activation, not a retry.
