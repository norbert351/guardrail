const MAROON = "#7B1133";
const GOLD_LIGHT = "#D9B47E";
const GOLD = "#C29B6D";
const GOLD_DARK = "#A98555";

/**
 * GuardRail logomark — hexagonal shield rail with a gold top corner,
 * maroon G crossbar, isometric gold cube glyph, and a pixel-disintegration
 * break drifting off the top-left (largest fragment gold).
 * Flat, scales cleanly at nav size, works on any background.
 */
export function Logomark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="GuardRail"
      className={className || "h-9 w-9"}
    >
      {/* Outer shield rail — maroon */}
      <path
        d="M20,9 L42,9 L57,22 L57,39 L44,57 L32,62 L20,57 L9,43 L9,24 L20,9 Z"
        fill="none"
        stroke={MAROON}
        strokeWidth={5}
        strokeLinejoin="round"
      />
      {/* Gold top-right corner of the rail */}
      <path
        d="M42,9 L57,22 L57,39"
        fill="none"
        stroke={GOLD}
        strokeWidth={4.5}
        strokeLinejoin="round"
      />
      {/* Maroon G crossbar */}
      <rect x="24" y="43" width="27" height="5" rx="2.5" fill={MAROON} />
      {/* Isometric gold cube glyph */}
      <path d="M30,22 L38,26 L30,30 L22,26 Z" fill={GOLD_LIGHT} />
      <path d="M22,26 L30,30 L30,41 L22,37 Z" fill={GOLD_DARK} />
      <path d="M38,26 L30,30 L30,41 L38,37 Z" fill={GOLD} />
      {/* Pixel disintegration fragments, top-left */}
      <rect x="8" y="8" width="4.5" height="4.5" rx="1" fill={MAROON} />
      <rect x="14" y="3.5" width="4" height="4" rx="0.9" fill={GOLD} />
      <rect x="4" y="13.5" width="3.5" height="3.5" rx="0.9" fill={MAROON} />
      <rect x="12" y="13" width="2.8" height="2.8" rx="0.8" fill={MAROON} />
      <rect x="6" y="19" width="2.4" height="2.4" rx="0.7" fill={MAROON} />
    </svg>
  );
}