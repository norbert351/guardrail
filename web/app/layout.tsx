import type { Metadata } from "next";
import { Space_Grotesk, Manrope, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// Site origin for OG previews. Set GUARDRAIL_SITE_URL to the real public
// domain in prod (Vercel/Render); falls back to Vercel's prod URL, then local.
const _site = (process.env.GUARDRAIL_SITE_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
const OG = _site ? (_site.startsWith("http") ? _site : `https://${_site}`) : "http://localhost:3050";

export const metadata: Metadata = {
  metadataBase: new URL(OG),
  title: "GuardRail — agents that can only act inside the limits you set",
  description:
    "Discover, hire and revoke BNB Chain AI agents. Every listing is verified onchain against the Altana KeyStore, so a dead or revoked agent can never be hired.",
  openGraph: {
    type: "website",
    url: OG,
    siteName: "GuardRail",
    title: "GuardRail — agents that can only act inside the limits you set",
    description:
      "Discover, hire and revoke BNB Chain AI agents. Every listing verified onchain against the Altana KeyStore.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "GuardRail — agents that can only act inside the limits you set" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GuardRail — agents that can only act inside the limits you set",
    description: "Discover, hire and revoke BNB Chain AI agents. Scope enforced onchain.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
