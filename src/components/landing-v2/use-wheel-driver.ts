"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import type { TextWheelHandle } from "@/components/landing-v2/text-wheel";
import { createLenisWheel } from "@/components/landing-v2/wheel-lenis";

/** React binding for the landing wheel. The motion itself is Lenis; see
 * wheel-lenis.ts. */
export type WheelDriver = {
  /** Pocket the wheel last came to rest in. */
  activeStep: number;
  /** True while the wheel is turning; the screens fade out until it stops. */
  moving: boolean;
  /** Spin to the word at `index`, the shorter way round. */
  spinToIndex: (index: number) => void;
};

/**
 * `wheel` is the ring being turned. Its rotation goes to it directly, every
 * frame, from inside Lenis's rAF — not through React state, which would reach
 * the DOM a task later and re-render the whole ring on the way. Only what the
 * slides need — which pocket the wheel rests in, and whether it is moving —
 * is state.
 *
 * `enabled` is false when the wheel has no room on screen: the landing falls
 * back to plain scrolling, and Lenis must not be hijacking the page.
 */
export function useWheelDriver(
  wheel: RefObject<TextWheelHandle | null>,
  enabled = true,
): WheelDriver {
  const [activeStep, setActiveStep] = useState(0);
  const [moving, setMoving] = useState(false);
  const spinRef = useRef<(index: number) => void>(() => {});

  useEffect(() => {
    if (!enabled) return;
    const lenisWheel = createLenisWheel({
      onRotation: (degrees) => wheel.current?.setRotation(degrees),
      onMoving: () => setMoving(true),
      onSettled: (step) => {
        // The slide only changes — and fades back in — once the wheel has
        // come to rest on a pocket.
        setActiveStep(step);
        setMoving(false);
      },
    });
    spinRef.current = lenisWheel.spinToIndex;
    return () => {
      spinRef.current = () => {};
      lenisWheel.destroy();
    };
  }, [enabled, wheel]);

  return {
    activeStep,
    moving,
    spinToIndex: (index: number) => spinRef.current(index),
  };
}
