"use client";

import dynamic from "next/dynamic";
import { LOGO_VARIANTS } from "./constants";

const { widthRem, heightRem } = LOGO_VARIANTS.header;

export const GxLogo = dynamic(
  () => import("./gx-logo").then((mod) => mod.GxLogo),
  {
    ssr: false,
    loading: () => (
      <div
        className="block shrink-0 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
        style={{ width: `${widthRem}rem`, height: `${heightRem}rem` }}
        aria-hidden
      />
    ),
  },
);
