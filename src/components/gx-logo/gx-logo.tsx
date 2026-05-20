"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import type { WebGLRenderer } from "three";
import {
  getLogoConfig,
  type LogoVariant,
} from "./constants";
import { configureGxLogoRenderer, GxLogoScene } from "./gx-logo-scene";
import { useGxLogoMotion } from "./use-gx-logo-motion";

export type GxLogoProps = {
  variant?: LogoVariant;
  className?: string;
  children?: React.ReactNode;
  /** Fixed square render size in CSS pixels (for icon export). */
  pixelSize?: number;
  /** Mouse parallax and hero float. Off for icon export. */
  interactive?: boolean;
  /** Required for canvas.toDataURL() capture. */
  preserveDrawingBuffer?: boolean;
  onGlReady?: (gl: WebGLRenderer) => void;
};

export function GxLogo({
  variant = "header",
  className,
  pixelSize,
  interactive = true,
  preserveDrawingBuffer = false,
  onGlReady,
  children,
}: GxLogoProps) {
  const config = getLogoConfig(variant);
  const isHero = variant === "hero";
  const { motionEnabled, disableMotion } = useGxLogoMotion(interactive);
  const isSquare =
    variant === "icon" || variant === "iconX" || pixelSize != null;
  const ariaLabel = variant === "iconX" ? "x" : "gx";

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={["block shrink-0", motionEnabled ? "cursor-pointer" : "", className]
        .filter(Boolean)
        .join(" ")}
      style={{
        width: pixelSize ?? (isHero ? "100%" : `${config.widthRem}rem`),
        height: pixelSize ?? `${config.heightRem}rem`,
        maxWidth:
          !pixelSize && config.maxWidthRem
            ? `${config.maxWidthRem}rem`
            : undefined,
        aspectRatio: isSquare ? "1" : undefined,
      }}
    >
      <Canvas
        frameloop={motionEnabled ? "always" : "demand"}
        camera={{
          position: config.camera.position,
          fov: config.camera.fov,
        }}
        gl={{
          alpha: true,
          antialias: motionEnabled,
          powerPreference: motionEnabled ? "high-performance" : "low-power",
          preserveDrawingBuffer,
        }}
        dpr={
          !motionEnabled
            ? 1
            : pixelSize && (variant === "icon" || variant === "iconX")
              ? 2
              : pixelSize
                ? 1
                : [1, 2]
        }
        onCreated={({ gl, camera, invalidate }) => {
          configureGxLogoRenderer(gl, variant);
          camera.lookAt(0, 0, 0);
          disableMotion(gl);
          if (!motionEnabled) invalidate();
          onGlReady?.(gl);
        }}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <Suspense fallback={null}>
          <GxLogoScene variant={variant} interactive={motionEnabled} />
          {children}
        </Suspense>
      </Canvas>
    </div>
  );
}
