import type { Metadata } from "next";
import { SeoJsonLd } from "@/components/seo/SeoJsonLd";
import { LandingPage } from "@/components/landing/LandingPage";
import {
  HOME_META_DESCRIPTION,
  HOME_OG_TITLE,
} from "@/lib/seo-constants";

export const metadata: Metadata = {
  description: HOME_META_DESCRIPTION,
  openGraph: {
    title: HOME_OG_TITLE,
    description: HOME_META_DESCRIPTION,
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "Hustronix",
    images: [
      {
        url: "/brand/hustronix-logo.png",
        width: 624,
        height: 222,
        alt: "Hustronix",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_OG_TITLE,
    description: HOME_META_DESCRIPTION,
    images: ["/brand/hustronix-logo.png"],
  },
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return (
    <>
      <SeoJsonLd />
      <LandingPage />
    </>
  );
}
