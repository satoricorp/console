"use client";

import dynamic from "next/dynamic";
import { LOGO_VARIANTS } from "./constants";

const { widthRem, heightRem } = LOGO_VARIANTS.header;
const { widthRem: heroWidthRem, heightRem: heroHeightRem } = LOGO_VARIANTS.hero;

export const TxLogo = dynamic(
  () => import("./tx-logo").then((mod) => mod.TxLogo),
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

/** Hero TX blender / 3D chrome transition — preserved for reuse. */
export const TxBlenderHero = dynamic(
  () => import("./tx-blender-hero").then((mod) => mod.TxBlenderHero),
  {
    ssr: false,
    loading: () => (
      <div
        className="block shrink-0 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
        style={{
          width: "100%",
          maxWidth: `${LOGO_VARIANTS.hero.maxWidthRem}rem`,
          height: `${heroHeightRem}rem`,
          aspectRatio: `${heroWidthRem} / ${heroHeightRem}`,
        }}
        aria-hidden
      />
    ),
  },
);
