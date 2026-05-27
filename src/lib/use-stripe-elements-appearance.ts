"use client";

import { useEffect, useState } from "react";
import type { Appearance } from "@stripe/stripe-js";

const lightAppearance: Appearance = {
  theme: "stripe",
  variables: {
    colorPrimary: "#18181b",
    colorBackground: "#ffffff",
    colorText: "#18181b",
    colorDanger: "#dc2626",
    borderRadius: "8px",
  },
};

const darkAppearance: Appearance = {
  theme: "night",
  variables: {
    colorPrimary: "#fafafa",
    colorBackground: "#18181b",
    colorText: "#fafafa",
    colorDanger: "#f87171",
    borderRadius: "8px",
  },
};

function getSystemDarkMode() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Stripe Elements appearance synced to the user's light/dark preference. */
export function useStripeElementsAppearance() {
  const [isDark, setIsDark] = useState(getSystemDarkMode);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setIsDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return {
    appearance: isDark ? darkAppearance : lightAppearance,
    /** Remount Elements when the OS theme changes (appearance is fixed at create time). */
    themeKey: isDark ? "dark" : "light",
  } as const;
}
