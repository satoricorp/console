import type { Metadata } from "next";

import { DesignOverview } from "./design-overview";

export const metadata: Metadata = {
  title: "GX brand assets",
  description: "Download GX chrome logos and inspect design reference assets",
  robots: { index: false, follow: false },
};

export default function DesignPage() {
  return <DesignOverview />;
}
