import type { Metadata } from "next";
import { LandingV2 } from "@/components/landing-v2/landing";

export const metadata: Metadata = {
  title: "gx: Code review that knows how the code was written",
  description:
    "gx records the agent session behind each commit and reviews your changes with that context. Findings before you push, summaries and answers in your PR. Plain Git, two commands.",
  // Hidden preview of the next landing page — keep it out of search indexes
  // until it replaces `/`.
  robots: { index: false, follow: false },
};

export default function NewLandingPreview() {
  return <LandingV2 />;
}
