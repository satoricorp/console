"use client";

import dynamic from "next/dynamic";

export const AsciiFooterArt = dynamic(
  () => import("./ascii-footer-art").then((mod) => mod.AsciiFooterArt),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden
        className="pointer-events-none h-72 w-full"
      />
    ),
  },
);
