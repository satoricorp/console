import type { Metadata } from "next";

import { IconExportClient } from "./icon-export-client";

export const metadata: Metadata = {
  title: "gx icon export",
  robots: { index: false, follow: false },
};

export default function IconExportPage() {
  return <IconExportClient />;
}
