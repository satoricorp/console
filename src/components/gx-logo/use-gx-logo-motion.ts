"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WebGLRenderer } from "three";

function isSoftwareWebGlRenderer(gl: WebGLRenderer): boolean {
  const context = gl.getContext();
  const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
  if (!debugInfo) return false;

  const renderer = context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
  return (
    typeof renderer === "string" &&
    /swiftshader|llvmpipe|software|basic render/i.test(renderer)
  );
}

/** Heuristic device check before enabling logo mouse motion. */
export function assessGxLogoMotionCapability(): boolean {
  if (typeof window === "undefined") return false;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }

  if (window.matchMedia("(hover: none)").matches) {
    return false;
  }

  const cores = navigator.hardwareConcurrency ?? 4;
  if (cores < 4) return false;

  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (memory != null && memory < 4) return false;

  return true;
}

export function useGxLogoMotion(requested: boolean) {
  const [motionEnabled, setMotionEnabled] = useState(false);
  const gpuBlocked = useRef(false);

  useEffect(() => {
    if (!requested) {
      setMotionEnabled(false);
      return;
    }
    if (gpuBlocked.current) return;
    setMotionEnabled(assessGxLogoMotionCapability());
  }, [requested]);

  const disableMotion = useCallback((gl: WebGLRenderer) => {
    if (!isSoftwareWebGlRenderer(gl)) return;
    gpuBlocked.current = true;
    setMotionEnabled(false);
  }, []);

  return { motionEnabled, disableMotion };
}
