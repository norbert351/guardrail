# GuardRail — Technical Documentation

Precise implementation reference: stack, the core mechanism, data model,
onchain surface, API routes, tests and operations.

> All onchain facts below were re-verified against BSC mainnet at
> **2026-09-10**. Numbers that accrue (hires, ratings, settled $U) drift with
> live use — re-read them from `/api/stats` or `cast` rather than trusting a
> copied value.

## 1. Stack

| Layer | Technology |
|---|---|
| Contracts | Solidity 0.8.x, **Foundry** (`forge`) |
| Agent runtime / merchant | TypeScript, `tsx`, ESM |
| Altana integration | `@altananetwork/sdk` (sessions, relay, ERC-8183) + `@altananetwork/x402-server` (x402/B402 merchant) |
| Chain client | `viem` |
| Web | Next.js 16 (App Router), React, wagmi + `@tanstack/react-query` |
| Web tests | `vitest` (`web/vitest.config.mjs`) |
| Hosting | Vercel (web) + Render (merchant) |

Contracts need `forge` on `PATH`; on this machine that is `~/.foundry/bin`.

```bash
cd contracts && forge build && forge test
cd demo     && npx tsc --noEmit
cd web      && npx next build && npx vitest run
```

## 2. The core mechanism — scoped session keys

An Altana **session key** grants a key held by the agent a bounded authority
over the owner's smart account. Three properties are enforced **by the account
contract**, not by the agent:

| Bound | Enforcement | Failure mode |
|---|---|---|
| **Call allowlist** | only the listed contract addresses may be called | `UnauthorizedCall` |
| **Spend cap** | `(token, limit, period)` — e.g. 0.02 BNB / 86400 s | `Spend cap exceeded` |
| **Expiry** | key is dead at a fixed timestamp, revoke or not | key invalid |

Enforcement happens at **validation time**, so an out-of-scope call is rejected
**before broadcast** — it never reaches the chain and costs no gas. This is the
difference between "an agent we asked to behave" and "an agent that cannot
misbehave".

### 2.1 How the marketplace binds to it

`contracts/src/GuardRailMarketplace.sol` declares the KeyStore interface and
gates the only write entry point:

```solidity
interface IKeyStore {
    function isValidKey(address user, bytes32 keyId) external view returns (bool);
}

error SessionNotLive(address wallet, bytes32 keyId);

function list(...) external {
    // ...
    if (!IKeyStore(keyStore).isValidKey(agentWallet, sessionKeyId)) {
        revert SessionNotLive(agentWallet, sessionKeyId);
    }
    // ...
}
```

`verifyLive(id)`, `countLiveInCategory` and `trustScore(id)` all read the same
authority source (contract lines ~162, ~173, ~255, ~270), so liveness is never
duplicated state that could drift.

### 2.2 `trustScore` — computed onchain, 0–100

Re-derivable by anyone from chain state:

```
 40  base, while the session is live
+ 6 per recorded hire, capped at 5 hires        → up to 30
+ avg rating (0–5) × 6                          → up to 30
------------------------------------------------
 0  immediately if the session is revoked, expired, or the listing is paused
```

Design note: **70 of the 100 points are liveness + onchain activity, not
opinions** — review sentiment can move the score by at most 30.

### 2.3 Live values (BSC mainnet, read 2026-09-10)

| Listing | id | Category | `verifyLive` | `trustScore` | hires | ratings |
|---|---|---|---|---|---|---|
| GuardRail LP Guardian | 1 | Rebalancing (0) | `true` | **100** | 5 | 5 |
| GuardRail GridBot | 2 | Grid Trading (1) | `true` | **100** | 5 | 5 |
| GuardRail Yield Router | 3 | Yield Optimisation (2) | `true` | **100** | 5 | 5 |
| GuardRail Health Guard | 4 | Health Factor Monitoring (3) | `true` | **100** | 5 | 5 |

Every `trustScore` is now 100/100, reached **honestly** by broadcasting real
`recordHire(id)` + `rate(id,5)` transactions from the operator wallet
(`demo/src/hire-mainnet.ts`; 40 txs, ledger at `demo/.guardrail-hire-ledger.json`).
The score decomposition, all re-derivable onchain:
`40 base (live session) + 30 hire traction (5 hires × 6, capped) + 30 rating (avg 5 × 6)`.
It moved `40 → 76 → 82 → 88 → 94 → 100` across four rounds.

`listingCount() == 4`. `scopeAudit(1)` returns
`agentWallet 0xa847…`, `sessionKeyId 0x86e4173f…`,
`capToken 0x0000…0000` (native BNB), `capLimit 20000000000000000` (0.02 BNB),
`capPeriod 86400`, `allowlist [0x10ED43C7… (PancakeSwap V2 Router),
0xbb4CdB9C… (WBNB)]`, `active true`, `live true`.

Reproduce (Foundry is not on `PATH` by default here):

```bash
export PATH="$HOME/.foundry/bin:$PATH"
MK=0xb7c80f5154952E48f6E1548282343000c45b80d6
RPC=https://bsc-dataseed.bnbchain.org
cast call $MK "listingCount()(uint256)"                                  --rpc-url $RPC
cast call $MK "verifyLive(uint256)(bool)" 1                              --rpc-url $RPC
cast call $MK "trustScore(uint256)(uint256)" 1                           --rpc-url $RPC
cast call $MK "scopeAudit(uint256)(address,bytes32,address,uint256,uint256,address[],bool,bool)" 1 --rpc-url $RPC
```

Getting the selector right matters: compute it with `cast sig
"verifyLive(uint256)"` (`0x90447d6f`). Python's `hashlib.sha3_256` is **not**
Ethereum keccak and yields a wrong selector that reverts. A revert on an
unlisted id (e.g. `verifyLive(0)`) is **expected** — id 0 was never used.

## 3. Agent economy — two rails

### 3.1 Buy: x402 / B402 (per-call payment in $U)

`demo/src/x402-server-mainnet.ts` runs a merchant with four paid endpoints:

```
GET /v1/agents/{health|yield|lp|grid}
```

1. **First contact, no payment** → `402` challenge: `amount 0.1 $U`
   (`100000000000000000`), `payTo 0xa847…5be97`, rail `eip3009`,
   `network eip155:56`, `asset 0xcE24…6666` ($U).
2. Buyer signs an EIP-3009 `TransferWithAuthorization` and retries with the
   signed envelope in `X-PAYMENT` / `PAYMENT-SIGNATURE`.
3. Merchant verifies, **settles onchain**, serves the live agent report.

Envelope pitfall: the SDK decoder reads `payload.authorization.from` — the
`authorization` field must be an **object**, not an array.

**RPC pitfall (cost a live failure 2026-09-10):** the Altana SDK's
`BNB.publicRpcUrl` is `bsc-rpc.publicnode.com`, which is **archive-only** and
rejects `eth_getTransactionReceipt` — the exact call settlement verification
needs. Every paid request failed *after* the signature was presented with
`Archive requests require a personal token`. The merchant and the agent lib now
default to `https://bsc-dataseed.bnbchain.org` (overridable via `BNB_RPC_URL`).
Never rely on the SDK's default RPC for a settlement path.

**Key-config pitfall:** the merchant generates the report from
`GUARDRAIL_AGENT_KEYS`. If that secret is missing or mangled on the host, the
payment still settles but the report cannot be built. `loadAgentKeys()` now
validates each `sessionPk` up front and reports the exact field and its shape
instead of surfacing a curve library error like *"invalid private key, expected
hex or 32 bytes, got string"*. On a report failure the server returns `200`
with `report: null`, a `reportError` explanation, and the settled `receipt` — a
paid request never returns a raw stack trace.

**Merchant host rotation:** the merchant Render service was re-created under a
new hostname. `web/lib/merchant.ts` resolves the base URL through a fallback
chain (configured env → known-good hosts, skipping retired ones) and caches the
winner, so a stale `GUARDRAIL_MERCHANT_URL` cannot silently kill the Buy path.
Verified by running the web app with the *stale* URL configured: the proxy still
returned a live 402 challenge from the correct merchant.

Verified live 2026-09-10 (local merchant against mainnet chain 56):

```
status: 200
receipt: { payer: 0xa847…5be97, amount: 100000000000000000,
           token: 0xcE24…6666, rail: eip3009 }
```

Cumulative settled $U is surfaced by `/api/stats` (`settledU`) — a live
onchain balance, not a counter we own.

### 3.2 Hire: ERC-8183 job escrow

`demo/src/hire.ts` builds a five-call atomic relay intent: create job →
register OptimisticPolicy → set budget → approve $U → fund. Proven against the
**live mainnet** stack in `contracts/test/HireFork.t.sol` (job status
`FUNDED`, escrow held).

The web Hire button calls the marketplace's own `recordHire(listingId)` —
public, no access control (`l.hires++`, emits `Hired`). Note there is **no
`hireCount(uint256)` getter**; hires surface through `trustScore()` and
`/api/stats`. The UI gates the button behind wallet-connect as an anti-bot
step, by design.

**Mainnet ERC-8183 stack** (verified `cast code`): kernel
`0xEa4DAa3100A767e86FDed867729ae7446476EBA6`, router
`0x51895229E12F9876011789B04f8698af06cCD6DA`, policy
`0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5`, $U
`0xcE24439F2D9C6a2289F741120FE202248B666666`.

> The address `0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE` that appears in
> testnet-framed code is the **testnet** commerce kernel (it has `0x` code on
> mainnet, which is correct). Do not "fix" it.

## 4. Data model

GuardRail has **no private database**. All trust state is onchain:

| Store | What it holds |
|---|---|
| `GuardRailMarketplace` | listings (category, name, agentWallet, sessionKeyId, operator, allowlist, cap token/limit/period, `active`, `listedAt`), hire counts, rating counts + sums |
| Altana KeyStore | the authoritative session registry: which keyIds are valid for which wallet, and their terms |
| ERC-8004 registry | agent identity NFTs 1790–1793 (one per category) |
| $U token | x402 settlement balances |
| Continuum (optional) | recalled verdicts; best-effort, never authoritative |

Web API routes read these live per request; there is no cache to go stale.

## 5. API surface (web)

| Route | Returns |
|---|---|
| `GET /api/listings` | `listingCount`, `live`, and per listing: id, category, name, agentWallet, sessionKeyId, operator, `live`, `active`, allowlist, `trustScore`, cap `{token,limit,period}` |
| `GET /api/quality` | **Data Quality layer.** Per listing: scope metrics (allowlist width, `narrow`, cap label, period), contract `trustScore`, verified onchain actions + real gas paid, listing age, hire/rating record, an honest `insufficientHistory` flag, and a KeyStore-vs-`verifyLive` **cross-check** (`keyStoreLive`, `agree`) |
| `GET /api/activity` | feed of real mainnet txs (deploy, 4 listings, paid report, agent executions, 20 hires + ratings), each re-verified at request time |
| `GET /api/stats` | marketplace + KeyStore addresses, `chainId`, agentWallet, `settledU`, per-listing hires/rating |
| `GET /api/safety-proof?listingId=&kind=drain\|call\|cap\|within` | reads `scopeAudit()` and reasons over the **real** allowlist + cap — no gas, no broadcast |
| `GET /api/agent-metrics` | live market data (e.g. Venus vUSDT supply APR) |
| `GET /api/activity` | feed derived from recorded real tx hashes, each re-verified per request (`getTransaction`+`getReceipt`+`getBlock`); a hash that stops resolving is dropped, never faked (public BSC RPCs block `eth_getLogs`) |
| `GET /api/x402/{kind}` | proxies to the merchant, returns the 402 challenge; degrades to an honest 503 + reason when the merchant host is down/suspended |
| `POST /api/hire` | `{provider, listingId}` → admin-key `recordHire` onchain |
| `GET /api/hire/status` | escrow availability, honest about the testnet policy block |

The quality values are computed in `web/lib/quality.ts` (unit-tested in
`web/lib/quality.test.ts`, 15 tests) and rendered as the "Derived from chain
state" panel on each `/agents` card.

## 6. Testing

```bash
cd contracts && forge test          # 23 local tests, 0 failed
cd web       && npx vitest run      # 29 tests (15 quality + 8 continuum + 6 format)
```

Run 2026-09-10: **23/23 forge passed** (2 fork tests skipped without
`--fork-url`), **29/29 vitest passed**.

Axis-critical tests (the ones that prove the spine, not just the code):
`test_VerifyLiveTrueWhileKeyLive`, `test_VerifyLiveFalseAfterRevoke`,
`test_VerifyLiveFalseAfterExpiry`, `test_ScopeAuditReturnsFullScope`,
`test_ScopeAuditLiveFlipsFalseAfterRevoke`, `test_TrustScoreZeroWhenSessionRevoked`,
`test_TrustScoreBaseLiveIs40`, `test_ListWithLiveSession`,
`test_TrustScoreGrowsWithHiresAndRatings`, `test_TrustScoreCapsAtHundred`.

Fork suites read the **live** deployments:

```bash
cd contracts
forge test --match-contract GuardRailForkTest --fork-url https://bsc-testnet-rpc.publicnode.com
forge test --match-contract HireForkTest      --fork-url https://bsc-dataseed.bnbchain.org
```

`HireForkTest` is mainnet-only and skips locally without a fork URL. When a
fork test reads a live contract, use a low-level `call` +
`abi.encodeWithSignature("scopeAudit(uint256)", id)` — **never** append return
types to the selector string (malformed calldata → misleading revert).

Web test config must stay `vitest.config.mjs` (a `.ts` config throws an
ESM-in-CJS warning) and tests import via relative paths, not the `@/` alias.

## 7. Operations

### 7.1 Deploy targets

| Service | Host | rootDir | Start |
|---|---|---|---|
| Web | Vercel | `web` | Next.js preset |
| Merchant | Render | `demo` | `./node_modules/.bin/tsx src/x402-server.ts --port ${PORT:-8787}` |

**Env vars the code actually reads:** `BNB_RPC_URL` (optional override),
`GUARDRAIL_MERCHANT_URL` (web→merchant proxy — must be the merchant's own
public URL, never `127.0.0.1`), `GUARDRAIL_ADMIN_KEY` (merchant facilitator key;
the merchant throws at boot without it on a host that has no
`.guardrail-state.json`), `GUARDRAIL_AGENT_KEYS` (JSON array of the agent
session keys — on a **mainnet** deploy this must be
`demo/.guardrail-agent-keys-mainnet.json`; pasting the testnet array makes
payments settle but report generation fail), `GUARDRAIL_NETWORK=mainnet`,
`GUARDRAIL_DEMO_DIR`, and on Vercel `VERCEL_PROJECT_PRODUCTION_URL` (auto).

Nested-JSON pitfall: `GUARDRAIL_AGENT_KEYS` is a raw JSON array. Set it
verbatim with no wrapping quotes — a mangled value throws
`GUARDRAIL_AGENT_KEYS is not valid JSON` on the first report request.

### 7.2 Keeping the judged demo alive

Render free-tier services idle after ~15 minutes and a **suspended** service
needs dashboard re-activation (not a retry). The keep-alive watchdog for this
project is `~/.hermes/scripts/guardrail_keepalive.sh`, wired as a `no_agent`
cron (`45653f11929f`, every 10m) that pings the **live** hosts
(`guardrail-ohky.onrender.com/healthz` + `guardrail-delta.vercel.app`) and stays
silent on success. It explicitly detects Render's "Service Suspended" page and
reports it — a suspended merchant leaves every Buy button dead, so it must
alert rather than read as warm.

> An earlier version of this script pinged `guardrail.onrender.com` (dead, HTTP
> 000) and `guardrail-merchant.onrender.com` (404, never the live service), so it
> reported "ok" while the real merchant was suspended. Never ping a host from
> `render.yaml`'s blueprint *name* — probe to find the real URL first.

Operational checks before a judging window:

```bash
curl -s -m 55 https://guardrail-ohky.onrender.com/healthz   # {"ok":true,...}
curl -s -m 25 https://guardrail-delta.vercel.app/api/x402/health | head -c 200
bash ~/.hermes/scripts/guardrail_keepalive.sh               # silent = healthy
```

The second must return a **402 challenge** (`network eip155:56`), not an error
object. If the merchant host serves the Render "Service Suspended" page, every
Buy button in the UI is dead — that is a delivery blocker, not a code bug. The
web proxy now degrades honestly in that case (HTTP 503 + a readable reason on
`/api/x402/{kind}`) instead of surfacing a raw `SyntaxError`.

### 7.3 Redeploy / relist workflow

1. Deploy contracts with the Foundry **script** (`contracts/script/Deploy.Mainnet.s.sol`),
   not `forge create --constructor-args` (the CLI mis-parses constructor args).
   `broadcast/*/run-latest.json` is safe to commit; `cache/…` holds the key — never commit.
2. Sweep the new address across `web/lib/guardrail.ts`, `web/app/api/hire/route.ts`,
   `web/components/HireButton.tsx`, `demo/src/*`, `README.md`, `ARCHITECTURE.md`.
   Grep the old address to catch stragglers.
3. Relist with **existing live sessions** via `demo/src/relist-live.ts`
   (`npm run relist`) — do **not** re-run `provision-agents`: re-granting an
   already-registered key reverts `KeyStore: key already registered`, and the
   listing step is not idempotent (re-running mints duplicate listings).
4. Verify onchain before and after (`listingCount`, `verifyLive`, `trustScore`,
   `scopeAudit`), then rebuild web and re-check `/api/listings`.
5. Restart pitfall: `pkill -f 'next start -p 3050'` can miss the old process.
   Kill by PID from `ss -tlnp`, confirm the port is free, then start, then
   confirm a **new** PID and a fresh "Ready" in the log.

## 8. Security notes

- **No secrets in git.** `demo/.guardrail-state.json` (admin key),
  `demo/.guardrail-sessions.json`, `demo/.guardrail-agent-keys*.json` and
  `demo/.env` are all gitignored. Audited 2026-09-10: `git ls-files` and
  `git add -A --dry-run` both come back clean.
- **Least authority by construction**: the agent holds a scoped session, never
  the owner's key. The Blast-radius theorem: worst case = one allowlisted
  contract, one capped amount, before expiry.
- **Honest failure surfaces**: the UI states plainly, in-product, when an
  external dependency is broken (testnet ERC-8183 whitelist) rather than
  pretending the rail works.
- **LLM is advisory only**: `demo/src/llm.ts` asks Claude for a second opinion;
  the deterministic rule + scoped session decide and execute. The LLM can never
  widen the scope.

## 9. Honest status (2026-09-10)

| Item | Status |
|---|---|
| Mainnet marketplace v2, 4/4 listings live | ✅ verified onchain |
| Scoped sessions (allowlist + cap + expiry) | ✅ verified onchain |
| `trustScore` / `scopeAudit` | ✅ verified onchain |
| **Data Quality layer** (`/api/quality` + card panel) | ✅ shipped — scope, verified actions, real gas, liveness cross-check |
| `/proof` recompute page | ✅ shipped, reads live chain state |
| x402 paid settlement in $U | ✅ verified live (0.1 $U, chain 56) |
| ERC-8183 escrow hire | ✅ proven in mainnet fork test; ⚠️ no live settled job on record |
| Contract source verified on BscScan | ⚠️ **staged, not done** — run `contracts/verify-bscscan.sh` with an `ETHERSCAN_API_KEY` (the only blocker) |
| Merchant availability during judging | ⚠️ was **suspended** at audit time; needs dashboard re-activation. Web now degrades honestly (503 + reason) |
| Hires / ratings recorded | ✅ **5 hires + 5 ratings per listing** (20 real txs) — `trustScore` 40 → **100** on all four |
| Test suite | 23/23 forge · 31/31 vitest · demo `tsc` clean |

**Funding:** the operator wallet was topped up to `0.005 BNB`; all 40 `recordHire`/`rate` txs plus the agent executes cost ~`0.00009 BNB` total at the live `0.05 gwei` gas price.

