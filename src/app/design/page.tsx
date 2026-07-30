import type { Metadata } from "next";

import { DesignOverview } from "./design-overview";

export const metadata: Metadata = {
  title: "TX brand assets",
  description: "Download TX chrome logos and inspect design reference assets",
  robots: { index: false, follow: false },
};

export default function DesignPage() {
  return <DesignOverview />;
}
