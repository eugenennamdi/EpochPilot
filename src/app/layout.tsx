import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Web3Provider } from "@/components/Web3Provider";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "EpochPilot — veMEZO & MUSD Gauge Router",
  description:
    "Automated veMEZO Gauge & MUSD Bribe Router for Mezo Network.",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "EpochPilot — veMEZO & MUSD Gauge Router",
    description:
      "Automated veMEZO Gauge & MUSD Bribe Router for Mezo Network.",
    images: ["/epochpilot-og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "EpochPilot — veMEZO & MUSD Gauge Router",
    description:
      "Automated veMEZO Gauge & MUSD Bribe Router for Mezo Network.",
    images: ["/epochpilot-og.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark`}
      suppressHydrationWarning
    >
      <body className="min-h-[100dvh] bg-[var(--background)] text-[var(--foreground)] antialiased selection:bg-[var(--foreground)] selection:text-[var(--background)]">
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}
