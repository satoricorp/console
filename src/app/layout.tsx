import type { Metadata } from "next";
import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { ConvexClientProvider } from "@/app/ConvexClientProvider";
import { GoogleAnalytics } from "@/components/google-analytics";
import { OnboardingGate } from "@/components/onboarding-gate";
import { PostHogIdentifier } from "@/components/posthog-identifier";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const fkDisplay = localFont({
  src: "../fonts/FKDisplay-Regular.otf",
  variable: "--font-fk-display",
  display: "swap",
});

const xer0 = localFont({
  src: "../fonts/Xer0-Regular.otf",
  variable: "--font-xer0",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GX: Version Control for Agents",
  description:
    "GX is a verification layer for AI-written code. It captures agent sessions, compares changes across multiple models, and uses repo-specific review context. Download for macOS — 1 week free.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fkDisplay.variable} ${xer0.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <Suspense fallback={null}>
          <GoogleAnalytics />
        </Suspense>
        <ConvexClientProvider>
          <PostHogIdentifier />
          <SiteHeader />
          <OnboardingGate>{children}</OnboardingGate>
          <SiteFooter />
        </ConvexClientProvider>
      </body>
    </html>
  );
}
