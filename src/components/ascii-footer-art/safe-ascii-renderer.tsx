"use client";

/* eslint-disable react-hooks/immutability -- Three.js exposes renderer DOM mutation as its integration API. */

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AsciiEffect } from "three-stdlib";

const MIN_CANVAS_PX = 32;

type SafeAsciiRendererProps = {
  renderIndex?: number;
  bgColor?: string;
  fgColor?: string;
  characters?: string;
  invert?: boolean;
  color?: boolean;
  resolution?: number;
};

function getAsciiDimensions(width: number, height: number, resolution: number) {
  return {
    width: Math.floor(width),
    height: Math.floor(height),
    asciiWidth: Math.floor(Math.floor(width) * resolution),
    asciiHeight: Math.floor(Math.floor(height) * resolution),
  };
}

function isValidAsciiSize(
  width: number,
  height: number,
  asciiWidth: number,
  asciiHeight: number,
) {
  return (
    width >= MIN_CANVAS_PX &&
    height >= MIN_CANVAS_PX &&
    asciiWidth >= 1 &&
    asciiHeight >= 1
  );
}

function resolveCssColor(value: string, element: HTMLElement) {
  if (typeof window === "undefined") return value;
  if (!value.includes("var(")) return value;

  const probe = document.createElement("span");
  probe.style.color = value;
  element.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || value;
}

function applyAsciiColors(
  domElement: HTMLElement,
  fgColor: string,
  bgColor: string,
) {
  domElement.style.setProperty("color", fgColor, "important");

  const table = domElement.querySelector("table");
  if (table instanceof HTMLElement) {
    table.style.setProperty("color", fgColor, "important");
  }

  const cell = domElement.querySelector("td");
  if (cell instanceof HTMLElement) {
    cell.style.setProperty("color", fgColor, "important");
    cell.style.setProperty("background-color", bgColor, "important");
  }
}

export function SafeAsciiRenderer({
  renderIndex = 1,
  bgColor = "transparent",
  fgColor = "darkgray",
  characters = " .:-=+*#%@#",
  invert = true,
  color = false,
  resolution = 0.12,
}: SafeAsciiRendererProps) {
  const { size, gl, scene, camera } = useThree();
  const mountedRef = useRef(false);
  const sizedRef = useRef(false);
  const colorsRef = useRef({ fg: fgColor, bg: bgColor });

  const { width, height, asciiWidth, asciiHeight } = getAsciiDimensions(
    size.width,
    size.height,
    resolution,
  );
  const canRender = isValidAsciiSize(width, height, asciiWidth, asciiHeight);

  const effect = useMemo(() => {
    const nextEffect = new AsciiEffect(gl, characters, {
      invert,
      color,
      resolution,
    });
    nextEffect.domElement.style.position = "absolute";
    nextEffect.domElement.style.top = "0px";
    nextEffect.domElement.style.left = "0px";
    nextEffect.domElement.style.pointerEvents = "none";
    return nextEffect;
  }, [gl, characters, invert, color, resolution]);

  useLayoutEffect(() => {
    colorsRef.current = {
      fg: resolveCssColor(fgColor, effect.domElement),
      bg: resolveCssColor(bgColor, effect.domElement),
    };
    applyAsciiColors(
      effect.domElement,
      colorsRef.current.fg,
      colorsRef.current.bg,
    );
  }, [effect, fgColor, bgColor]);

  useLayoutEffect(() => {
    sizedRef.current = false;
    if (!canRender) return;
    effect.setSize(width, height);
    sizedRef.current = true;
  }, [effect, width, height, canRender]);

  useEffect(() => {
    if (!canRender) {
      if (mountedRef.current) {
        gl.domElement.style.opacity = "1";
        gl.domElement.style.visibility = "visible";
        effect.domElement.remove();
        mountedRef.current = false;
      }
      return;
    }

    gl.domElement.style.opacity = "0";
    gl.domElement.style.visibility = "hidden";
    gl.domElement.parentNode?.appendChild(effect.domElement);
    mountedRef.current = true;
    applyAsciiColors(
      effect.domElement,
      colorsRef.current.fg,
      colorsRef.current.bg,
    );

    return () => {
      gl.domElement.style.opacity = "1";
      gl.domElement.style.visibility = "visible";
      effect.domElement.remove();
      mountedRef.current = false;
      sizedRef.current = false;
    };
  }, [canRender, effect, gl]);

  useFrame(() => {
    if (!canRender || !mountedRef.current || !sizedRef.current) return;
    effect.render(scene, camera);
    applyAsciiColors(
      effect.domElement,
      colorsRef.current.fg,
      colorsRef.current.bg,
    );
  }, renderIndex);

  return null;
}
