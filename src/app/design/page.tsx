import type { Metadata } from "next";

import { DesignOverview } from "./design-overview";

export const metadata: Metadata = {
  title: "Design overview · Console",
  description: "Colors, typography, GX chrome mark, and icon export reference",
  robots: { index: false, follow: false },
};

export default function DesignPage() {
  return <DesignOverview />;
}
