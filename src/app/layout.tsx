import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import { AccountSession } from "./account-session";
import { ServiceWorkerRegistration } from "./service-worker-registration";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage",
});

const figtree = Figtree({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-figtree",
});

const title = "Closet";
const description = "Get dressed from your own closet.";
const siteOrigin = new URL(
  process.env.CLOSET_TARGET === "vercel"
    ? process.env.APP_ORIGIN || "https://shopee-openai-mbti-closet.vercel.app"
    : "https://mbti-closet.stonyimpala.chatgpt.site",
);
const thumbnail = {
  url: "/closet-thumbnail.png",
  width: 1200,
  height: 630,
  alt: "Closet. Get dressed from your own closet. A coral shirt, dark trousers, and cream sneakers.",
};

export const metadata: Metadata = {
  metadataBase: siteOrigin,
  title,
  description,
  applicationName: title,
  icons: {
    icon: { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    apple: { url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
  },
  openGraph: { type: "website", title, description, images: [thumbnail] },
  twitter: { card: "summary_large_image", title, description, images: [thumbnail] },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Closet" },
};

export const viewport: Viewport = { themeColor: "#FCFAF6", viewportFit: "cover" };

const website = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: title,
  description,
  url: siteOrigin.href,
  image: new URL("/closet-logo.svg", siteOrigin).href,
  thumbnailUrl: new URL(thumbnail.url, siteOrigin).href,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} ${figtree.variable} h-full antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <script type="application/ld+json" dangerouslySetInnerHTML={{
          __html: JSON.stringify(website).replace(/</g, "\\u003c"),
        }} />
        <ServiceWorkerRegistration />
        <AccountSession>{children}</AccountSession>
      </body>
    </html>
  );
}
