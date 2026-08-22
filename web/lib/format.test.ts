import { describe, it, expect } from "vitest";
import { capLabel, trustScoreLabel, clampScore } from "./format";

describe("capLabel", () => {
  it("formats a native BNB daily cap", () => {
    // 0.02 tBNB/day, native token, 1 day period.
    expect(capLabel({ token: "0x0000000000000000000000000000000000000000", limit: "20000000000000000", period: 86400 })).toBe(
      "0.020 BNB/day cap",
    );
  });

  it("omits the period when there is no rolling window", () => {
    expect(capLabel({ token: "0x0000000000000000000000000000000000000000", limit: "1000000000000000000" })).toBe("1.000 BNB cap");
  });

  it("labels non-native caps as tokens", () => {
    expect(capLabel({ token: "0x55d398326f99059fF775485246999027B3197955", limit: "5000000000000000000" })).toBe("5.000 tokens cap");
  });

  it("returns null when there is no cap", () => {
    expect(capLabel(undefined)).toBeNull();
    expect(capLabel({})).toBeNull();
  });
});

describe("trustScoreLabel", () => {
  it("buckets the score", () => {
    expect(trustScoreLabel(0)).toBe("not trustable");
    expect(trustScoreLabel(-1)).toBe("not trustable");
    expect(trustScoreLabel(30)).toBe("growing");
    expect(trustScoreLabel(49)).toBe("growing");
    expect(trustScoreLabel(50)).toBe("trusted");
    expect(trustScoreLabel(79)).toBe("trusted");
    expect(trustScoreLabel(80)).toBe("high trust");
    expect(trustScoreLabel(100)).toBe("high trust");
  });
});

describe("clampScore", () => {
  it("clamps into 0-100", () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(150)).toBe(100);
    expect(clampScore(40)).toBe(40);
  });
});