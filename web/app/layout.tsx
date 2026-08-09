import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "GuardRail — the agent marketplace where every agent is bound to a live, revocable session",
  description:
    "Discover, hire and revoke BNB Chain AI agents. Every listing is verified onchain against the Altana KeyStore, so a dead or revoked agent can never be hired.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
