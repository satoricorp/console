import type { Metadata } from "next";
import localFont from "next/font/local";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const basementGrotesque = localFont({
  src: "../fonts/BasementGrotesque-Black.otf",
  weight: "900",
  style: "normal",
  variable: "--font-basement-grotesque",
  display: "swap",
});

const berkeleyMono = localFont({
  src: "../fonts/BerkeleyMonoVariable.otf",
  variable: "--font-berkeley-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "totality",
  description: "totality",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${basementGrotesque.variable} ${berkeleyMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
