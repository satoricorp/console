"use client";

import { useEffect, useRef, useState } from "react";
import { createLenisWheel } from "@/components/landing-v2/wheel-lenis";

/** React binding for the landing wheel. The motion itself is Lenis; see
 * wheel-lenis.ts. */
export type WheelDriver = {
  /** Wheel rotation in degrees. */
  rotation: number;
  /** Pocket the wheel last came to rest in. */
  activeStep: number;
  /** True while the wheel is turning; the screens fade out until it stops. */
  moving: boolean;
  /** Spin to the word at `index`, the shorter way round. */
  spinToIndex: (index: number) => void;
};

export function useWheelDriver(): WheelDriver {
  const [rotation, setRotation] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const [moving, setMoving] = useState(false);
  const spinRef = useRef<(index: number) => void>(() => {});

  useEffect(() => {
    const wheel = createLenisWheel({
      onRotation: setRotation,
      onMoving: () => setMoving(true),
      onSettled: (step) => {
        // The slide only changes — and fades back in — once the wheel has
        // come to rest on a pocket.
        setActiveStep(step);
        setMoving(false);
      },
    });
    spinRef.current = wheel.spinToIndex;
    return () => {
      spinRef.current = () => {};
      wheel.destroy();
    };
  }, []);

  return {
    rotation,
    activeStep,
    moving,
    spinToIndex: (index: number) => spinRef.current(index),
  };
}
