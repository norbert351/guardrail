/**
 * GuardRail live demo on BNB testnet (chain 97).
 *
 * The narrative, end to end:
 *   1. A self-custodial Altana wallet is created. The admin key never leaves
 *      this script's hands, and is never handed to the "agent".
 *   2. A scoped session is granted: the agent may call only the PancakeSwap
 *      router and WBNB, spend at most 0.05 tBNB per day, and the key expires
 *      in 7 days. The session key is registered in the public Altana KeyStore.
 *   3. A legit call (wrap 0.001 tBNB into WBNB) inside the cap succeeds.
 *   4. The Bankr-style attacks are replayed: drain the whole wallet over the
 *      cap, and call a contract outside the allowlist. Both are blocked at
 *      onchain validation, before any funds move.
 *   5. Anyone (no SDK, no key) verifies the session key is live via a plain
 *      isValidKey read on the public KeyStore.
 *   6. One-tx revoke. The key dies instantly: isValidKey flips false and a
 *      follow-up execute reverts.
 *
 * Everything happens onchain on BSC testnet through the Altana relay.
 * The admin key is persisted in .guardrail-state.json so the wallet address
 * is stable across runs. Fund the printed address with testnet BNB once
 * (the Altana relay's native faucet is broken, so a manual top-up is needed).
 */

import {
  createClient,
  BNB_TESTNET,
  signerFromPrivateKey,
  waitForBalance,
  type Session,
} from "@altananetwork/sdk";
import { createPublicClient, http, keccak256, parseEther, type Address } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---- deterministic admin key: same wallet across runs --------------------
const STATE_FILE = join(process.cwd(), ".guardrail-state.json");
function loadAdminKey(): `0x${string}` {
  if (process.env.GUARDRAIL_ADMIN_PK) return process.env.GUARDRAIL_ADMIN_PK as `0x${string}`;
  if (existsSync(STATE_FILE)) {
    const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    if (state.adminKey) return state.adminKey as `0x${string}`;
  }
  const key = generatePrivateKey();
  writeFileSync(STATE_FILE, JSON.stringify({ adminKey: key }, null, 2));
  console.log(`[STATE] admin key persisted to ${STATE_FILE}`);
  return key;
}

// ---- chain 97 addresses -------------------------------------------------
const PANCAKE_ROUTER: Address = "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3";
const WBNB: Address = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const KEYSTORE: Address = "0x6b8361C29d05D498b1a12B54A37310f94171E94A";
const EXPLORER = "https://testnet.bscscan.com/tx/";
const ALTANA_EXPLORER = "https://testnet.altana.network";

// ---- session policy: the GuardRail core ---------------------------------
const SPEND_CAP = parseEther("0.05"); // 0.05 tBNB per day
const EXPIRY = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
const MIN_BALANCE = parseEther("0.02"); // enough for a handful of relay txs

const KEYSTORE_ABI = [
  {
    name: "isValidKey",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "keyId", type: "bytes32" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`);
}

type AttemptResult =
  | { ok: true; tx?: `0x${string}`; status?: string }
  | { ok: false; error: string };

async function attempt(fn: () => Promise<{ transactionHash?: `0x${string}`; status?: string }>): Promise<AttemptResult> {
  try {
    const r = await fn();
    return { ok: true, tx: r.transactionHash, status: r.status };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 240) };
  }
}

async function main() {
  const pubClient = createPublicClient({
    chain: BNB_TESTNET.chain,
    transport: http(BNB_TESTNET.publicRpcUrl),
  });

  // ---- 1. wallet -------------------------------------------------------
  const client = createClient({ chains: [BNB_TESTNET] });
  const adminKey = loadAdminKey();
  const adminSigner = signerFromPrivateKey(adminKey);
  const wallet = await client.createWallet({ signer: adminSigner });
  const walletAddress = wallet.address as Address;
  log("1. WALLET", `self-custodial Altana wallet ${walletAddress} (admin key held here, never given to the agent)`);

  // ---- 2. funding gate --------------------------------------------------
  const balance = await pubClient.getBalance({ address: walletAddress });
  log("2. FUND", `balance ${balance} wei tBNB`);
  if (balance < MIN_BALANCE) {
    console.log(
      `\nFUND THIS ADDRESS, then re-run:\n  ${walletAddress}\n` +
        `  ~0.05 tBNB from https://testnet.bnbchain.org/faucet-smart\n`,
    );
    return;
  }
  log("2. FUND", "balance confirmed, no human faucet needed this run");

  // ---- 3. grant the scoped session -------------------------------------
  log(
    "3. SESSION",
    `granting agent a session: calls only to router + WBNB, spend cap 0.05 tBNB/day, expires in 7 days`,
  );
  const session: Session = await client.grantSession({
    wallet,
    signer: adminSigner,
    permissions: {
      calls: [{ to: PANCAKE_ROUTER }, { to: WBNB }],
      spend: [{ limit: SPEND_CAP, period: "day" }],
    },
    expiry: EXPIRY,
  });
  log("3. SESSION", `session granted, key registered in KeyStore (register defaults true)`);

  // ---- 4. legit call inside the cap -------------------------------------
  log("4. LEGIT", "agent wraps 0.001 tBNB -> WBNB (inside cap, inside allowlist)");
  const wbnbDeposit = "0xd0e30db0"; // deposit()
  const legit = await client.execute({
    session,
    calls: [{ to: WBNB, data: wbnbDeposit, value: parseEther("0.001") }],
  });
  log("4. LEGIT", `status=${legit.status} tx=${EXPLORER}${legit.transactionHash}`);

  // ---- 5. attack replay: Bankr-style drains ------------------------------
  log("5. ATTACK", "replaying the Bankr-style drain attempts");

  // 5a. drain everything: 10 tBNB transfer far over the 0.05/day cap
  const attacker: Address = "0x00000000000000000000000000000000DeaDBeef";
  const drainOverCap = await attempt(() =>
    client.execute({
      session,
      calls: [{ to: attacker, value: parseEther("10") }],
    }),
  );
  log("5a. ATTACK", drainOverCap.ok ? "UNBLOCKED, funds moved!" : `blocked at validation: ${drainOverCap.error}`);

  // 5b. call a contract outside the allowlist (a fake "approve everything" token)
  const evilToken: Address = "0x1111111111111111111111111111111111111111";
  const approveAll =
    "0x095ea7b3" + // approve(address,uint256)
    "000000000000000000000000000000000000000000000000000000000000dead" +
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  const drainViaApprove = await attempt(() =>
    client.execute({ session, calls: [{ to: evilToken, data: approveAll as `0x${string}` }] }),
  );
  log("5b. ATTACK", drainViaApprove.ok ? "UNBLOCKED, approval granted!" : `blocked at validation: ${drainViaApprove.error}`);

  // ---- 6. verify from anywhere: plain KeyStore read ----------------------
  log("6. VERIFY", "any third party verifies the agent's authority with a free isValidKey read");
  const keyId = keccak256(session.publicKey);
  const liveBefore = await pubClient.readContract({
    address: KEYSTORE,
    abi: KEYSTORE_ABI,
    functionName: "isValidKey",
    args: [walletAddress, keyId],
  });
  log("6. VERIFY", `isValidKey(wallet, keccak256(sessionPubKey)) = ${liveBefore} while session live`);

  // ---- 7. one-tx revoke -------------------------------------------------
  log("7. REVOKE", "user cuts the agent with one transaction");
  const revoke = await client.revokeSession({ wallet, signer: adminSigner, session });
  log("7. REVOKE", `status=${revoke.status} tx=${EXPLORER}${revoke.transactionHash}`);

  const liveAfter = await pubClient.readContract({
    address: KEYSTORE,
    abi: KEYSTORE_ABI,
    functionName: "isValidKey",
    args: [walletAddress, keyId],
  });
  log("7. REVOKE", `isValidKey after revoke = ${liveAfter} (key is dead instantly)`);

  // ---- 8. post-revoke execute must fail ----------------------------------
  log("8. AFTER", "the agent tries again after revoke");
  const after = await attempt(() =>
    client.execute({ session, calls: [{ to: WBNB, data: wbnbDeposit, value: parseEther("0.001") }] }),
  );
  log("8. AFTER", after.ok ? "session still active, unexpected!" : `reverted: ${after.error}`);

  const finalBalance = await pubClient.getBalance({ address: walletAddress });
  console.log(`\nGuardRail demo complete. Wallet ${walletAddress} balance: ${finalBalance} wei tBNB.`);
  console.log(`Altana explorer: ${ALTANA_EXPLORER}/wallet/${walletAddress}`);
}

main().catch((e) => {
  console.error("demo failed:", e);
  process.exit(1);
});
