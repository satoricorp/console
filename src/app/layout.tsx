import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "@/app/ConvexClientProvider";
import { OnboardingGate } from "@/components/onboarding-gate";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GX — Review what matters at shipping speed",
  description:
    "GX organizes your work into linear stacks so code review never bottlenecks how fast you ship. Know what you are shipping — review what matters, revision by revision. Download for macOS — 3 full-stack reviews free.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <ConvexClientProvider>
          <SiteHeader />
          <OnboardingGate>{children}</OnboardingGate>
          <SiteFooter />
        </ConvexClientProvider>
      </body>
    </html>
  );
}
