"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import type { WebGLRenderer } from "three";
import {
  getLogoConfig,
  type LogoTone,
  type LogoVariant,
} from "./constants";
import { configureGxLogoRenderer, GxLogoScene } from "./gx-logo-scene";
import { useGxLogoMotion } from "./use-gx-logo-motion";

export type { LogoTone } from "./constants";

export type GxLogoProps = {
  variant?: LogoVariant;
  tone?: LogoTone;
  className?: string;
  children?: React.ReactNode;
  /** Fixed square render size in CSS pixels (for icon export). */
  pixelSize?: number;
  /** Mouse parallax and hero float. Off for icon export. */
  interactive?: boolean;
  /** Required for canvas.toDataURL() capture. */
  preserveDrawingBuffer?: boolean;
  /** HDR cubemap face size (icon export — keep ≤1024 to limit GPU memory). */
  environmentResolution?: number;
  /** Override frameloop (icon capture uses `always` until SceneCaptureBridge finishes). */
  frameloop?: "always" | "demand" | "never";
  onGlReady?: (gl: WebGLRenderer) => void;
};

export function GxLogo({
  variant = "header",
  tone = "chrome",
  className,
  pixelSize,
  interactive = true,
  preserveDrawingBuffer = false,
  environmentResolution,
  frameloop: frameloopProp,
  onGlReady,
  children,
}: GxLogoProps) {
  const config = getLogoConfig(variant);
  const isHero = variant === "hero";
  const { motionEnabled, disableMotion } = useGxLogoMotion(interactive);
  const isSquare =
    variant === "icon" || variant === "iconX" || pixelSize != null;
  const ariaLabel = variant === "iconX" ? "x" : "gx";
  const isHeader = variant === "header" || variant === "footer";
  /** Header is a small canvas — allow Retina DPR without the hero's continuous loop cost. */
  const dpr =
    isHeader
      ? ([1, 2] as [number, number])
      : !motionEnabled || variant === "hero"
        ? 1
        : pixelSize && (variant === "icon" || variant === "iconX")
          ? 2
          : 1;
  const antialias = isHeader || isHero || motionEnabled;
  /** Header: parallax on hover only, demand frameloop (no 60fps beside the hero). */
  const hoverDrivenMotion = isHeader && motionEnabled;
  const canvasFrameloop =
    frameloopProp ??
    (motionEnabled ? (hoverDrivenMotion ? "demand" : "always") : "demand");

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={[
        "block shrink-0",
        config.markAlign === "start" ? "overflow-visible" : "",
        motionEnabled ? "cursor-pointer" : "",
        className,
      ]
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
        marginLeft:
          config.markInsetXRem !== undefined
            ? `${config.markInsetXRem}rem`
            : undefined,
      }}
    >
      <Canvas
        frameloop={canvasFrameloop}
        camera={{
          position: config.camera.position,
          fov: config.camera.fov,
        }}
        gl={{
          alpha: true,
          antialias,
          powerPreference:
            motionEnabled && isHero ? "high-performance" : "low-power",
          preserveDrawingBuffer,
        }}
        dpr={dpr}
        onCreated={({ gl, camera, invalidate }) => {
          configureGxLogoRenderer(gl, variant, tone);
          camera.lookAt(0, 0, 0);
          disableMotion(gl);
          invalidate();
          onGlReady?.(gl);
        }}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <Suspense fallback={null}>
          <GxLogoScene
            variant={variant}
            tone={tone}
            interactive={motionEnabled}
            hoverDrivenMotion={hoverDrivenMotion}
            environmentResolution={environmentResolution}
          />
          {children}
        </Suspense>
      </Canvas>
    </div>
  );
}
