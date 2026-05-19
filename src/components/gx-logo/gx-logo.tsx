"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import {
  getLogoConfig,
  type LogoVariant,
} from "./constants";
import { configureGxLogoRenderer, GxLogoScene } from "./gx-logo-scene";

type GxLogoProps = {
  variant?: LogoVariant;
  className?: string;
};

export function GxLogo({ variant = "header", className }: GxLogoProps) {
  const config = getLogoConfig(variant);
  const isHero = variant === "hero";

  return (
    <div
      role="img"
      aria-label="gx"
      className={["block shrink-0 cursor-pointer", className]
        .filter(Boolean)
        .join(" ")}
      style={{
        width: isHero ? "100%" : `${config.widthRem}rem`,
        height: `${config.heightRem}rem`,
        maxWidth: config.maxWidthRem ? `${config.maxWidthRem}rem` : undefined,
      }}
    >
      <Canvas
        camera={{
          position: config.camera.position,
          fov: config.camera.fov,
        }}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        }}
        dpr={[1, 2]}
        onCreated={({ gl, camera }) => {
          configureGxLogoRenderer(gl);
          camera.lookAt(0, 0, 0);
        }}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <Suspense fallback={null}>
          <GxLogoScene variant={variant} />
        </Suspense>
      </Canvas>
    </div>
  );
}
