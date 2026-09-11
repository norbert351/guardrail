import { NextResponse } from "next/server";
import { enumerateRegistry, IDENTITY_REGISTRY, readAgent } from "@/lib/registry";

export const dynamic = "force-dynamic";

/**
 * GET /api/registry                 → enumerate a bounded id window
 * GET /api/registry?agentId=345084  → one agent
 *
 * The open discovery surface: every agent anyone has registered on the BSC
 * mainnet ERC-8004 IdentityRegistry, read straight from the contract — no
 * submission, no database, no approval. Bounded by `from`/`to` so a public RPC
 * is never asked to scan unbounded.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId");

  try {
    if (agentId) {
      const id = Number(agentId);
      if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ ok: false, error: "agentId must be a positive integer" }, { status: 400 });
      }
      const agent = await readAgent(id);
      if (!agent) {
        return NextResponse.json({ ok: false, error: `agent ${id} is not registered` }, { status: 404 });
      }
      return NextResponse.json({ ok: true, registry: IDENTITY_REGISTRY, chainId: 56, agent });
    }

    // Keep the default window tight; callers can widen with from/to.
    const from = Number(url.searchParams.get("from") ?? "345000");
    const to = Number(url.searchParams.get("to") ?? "345100");
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from || to - from > 400) {
      return NextResponse.json(
        { ok: false, error: "invalid range: need integers with from <= to and to - from <= 400" },
        { status: 400 },
      );
    }

    const { agents, scanned, live } = await enumerateRegistry({ from, to });
    return NextResponse.json({
      ok: true,
      chainId: 56,
      registry: IDENTITY_REGISTRY,
      scanned,
      live,
      note:
        "read live from the ERC-8004 IdentityRegistry contract; ids that are not minted are omitted (ownerOf reverts). No submission or approval step.",
      agents,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `registry read failed: ${String(e).slice(0, 200)}` },
      { status: 502 },
    );
  }
}
