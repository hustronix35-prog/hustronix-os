import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { LandingThemeGuard } from "@/components/theme/LandingThemeGuard";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { themeBlockingScript } from "@/components/theme/theme-script";
import { getSiteUrl, isSeoNoIndex } from "@/lib/site";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const siteUrl = getSiteUrl();
const noIndex = isSeoNoIndex();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Decision Operating System",
    template: "Hustronix | %s",
  },
  description:
    "Hustronix: the Decision Operating System for ledger-backed decisions, signals, and auditable execution at hustronix.online.",
  robots: noIndex
    ? { index: false, follow: false, googleBot: { index: false, follow: false } }
    : { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Hustronix",
    locale: "en_US",
    images: [{ url: "/brand/hustronix-mark.png", alt: "Hustronix" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/brand/hustronix-mark.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} h-full scrollbar-hide`}
    >
      <head />
      {/* Extensions inject attrs before hydrate (e.g. bis_skin_checked on many nodes). */}
      <body
        className="min-h-full scrollbar-hide bg-hx-bg font-sans antialiased text-hx-text"
        suppressHydrationWarning
      >
        <Script
          id="hustronix-theme-blocking"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeBlockingScript }}
        />
        <ThemeProvider>
          <LandingThemeGuard />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
