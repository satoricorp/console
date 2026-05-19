"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { AsciiFooterScene } from "./ascii-footer-scene";
import { SafeAsciiRenderer } from "./safe-ascii-renderer";

type AsciiFooterArtProps = {
  className?: string;
};

export function AsciiFooterArt({ className }: AsciiFooterArtProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasSize, setHasSize] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const update = () => {
      const { width, height } = node.getBoundingClientRect();
      setHasSize(width >= 32 && height >= 32);
    };

    update();

    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={["pointer-events-none select-none", className]
        .filter(Boolean)
        .join(" ")}
    >
      {hasSize ? (
        <Canvas
          camera={{ position: [0, 0, 4.2], fov: 42 }}
          gl={{ alpha: true, antialias: false, powerPreference: "low-power" }}
          dpr={1}
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <Suspense fallback={null}>
            <AsciiFooterScene />
          </Suspense>
          <SafeAsciiRenderer
            bgColor="transparent"
            fgColor="#636E72"
            characters=" .:-=+*#%@"
            resolution={0.2}
            invert
          />
        </Canvas>
      ) : null}
    </div>
  );
}
