import type { Metadata, Viewport } from "next";
import { SiteFooter, SiteHeader } from "@/components/layout/SiteHeader";
import { PINNED_STATE_SCRIPT } from "@/components/layout/pinning";
import styles from "@/components/layout/layout.module.css";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "WikiHole — The internet's deepest rabbit holes",
    template: "%s · WikiHole",
  },
  description:
    "A ranked stream of obscure, technically deep Wikipedia articles: computer science, mathematics, physics, engineering, biology and economics. Read them in a focused reader and follow the links down the rabbit hole.",
  applicationName: "WikiHole",
  openGraph: {
    type: "website",
    siteName: "WikiHole",
    title: "WikiHole — The internet's deepest rabbit holes",
    description: "Discover obscure, technically fascinating Wikipedia articles you didn't know existed.",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The pinned/hidden sidebar state is applied to <html> before first paint (see pinning.ts).
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PINNED_STATE_SCRIPT }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <div className={styles.headerContainer}>
          <SiteHeader />
        </div>
        <div className={styles.pageContainer}>
          <main id="main" className={styles.main}>
            {children}
          </main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
