import type { ReactNode } from "react";
import { RootProvider } from "fumadocs-ui/provider/next";
import "./global.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider search={{ options: { api: "/api/search" } }}>{children}</RootProvider>
      </body>
    </html>
  );
}

export const metadata = {
  title: "My Product"
};
