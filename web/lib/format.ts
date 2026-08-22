/**
 * GuardRail web formatting + grading helpers.
 * Pure functions, exported so they can be unit-tested and re-used where the
 * scope/cap and trust score are shown.
 */

export type ScopeCap = { token?: string; limit?: string; period?: number };

/** Human label for a listing's spend cap as recorded onchain. */
export function capLabel(cap?: ScopeCap): string | null {
  if (!cap || cap.limit === undefined) return null;
  const limit = Number(BigInt(cap.limit)) / 1e18;
  const periodDays = cap.period ? Math.round(cap.period / 86400) : undefined;
  const native = cap.token === "0x0000000000000000000000000000000000000000";
  const suffix = native ? "BNB" : "tokens";
  return periodDays ? `${limit.toFixed(3)} ${suffix}/day cap` : `${limit.toFixed(3)} ${suffix} cap`;
}

/** Bucket label for an onchain trust score (0-100). */
export function trustScoreLabel(score: number): string {
  if (score <= 0) return "not trustable";
  if (score >= 80) return "high trust";
  if (score >= 50) return "trusted";
  return "growing";
}

/** Clamp a raw score into the valid 0-100 range (defensive). */
export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}