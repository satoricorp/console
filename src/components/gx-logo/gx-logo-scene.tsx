"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  Center,
  Environment,
  Float,
  Lightformer,
  Text3D,
  useFont,
} from "@react-three/drei";
import {
  ACESFilmicToneMapping,
  SRGBColorSpace,
  type BufferGeometry,
  type Mesh,
  type WebGLRenderer,
} from "three";
import { Box3, Vector3, type Group } from "three";

import {
  getLogoConfig,
  HEADER_ENVIRONMENT_RESOLUTION,
  HERO_ENVIRONMENT_RESOLUTION,
  ICON_ENVIRONMENT_RESOLUTION,
  USE_GX_LOGO_MESH,
  type LogoVariant,
  type LogoVariantConfig,
} from "./constants";
import { GxGlbModel } from "./gx-glb-model";
import { laplacianSmoothGeometry } from "./round-geometry";

const BLOB_FONT = "/fonts/Blob-Regular.typeface.json";

useFont.preload(BLOB_FONT);

type GxLogoSceneProps = {
  variant?: LogoVariant;
  /** When false, no mouse parallax or float — used for icon PNG export. */
  interactive?: boolean;
  /** Header: repaint on hover / ease-out only (demand frameloop). */
  hoverDrivenMotion?: boolean;
  /** HDR cubemap face size — lower for icon export to save GPU memory. */
  environmentResolution?: number;
};

const MOTION_EPS = 0.002;

function SplineChrome() {
  return (
    <meshPhysicalMaterial
      color="#e9edf7"
      metalness={1}
      roughness={0.04}
      clearcoat={1}
      clearcoatRoughness={0.015}
      reflectivity={1}
      envMapIntensity={1.85}
      ior={1.45}
    />
  );
}

function SplineLighting({
  variant,
  environmentResolution,
}: {
  variant: LogoVariant;
  environmentResolution?: number;
}) {
  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[8, 10, 12]} intensity={2.2} color="#ffffff" />
      <directionalLight position={[-10, 4, 8]} intensity={1.1} color="#d8e6ff" />
      <pointLight position={[0, 0, 10]} intensity={16} color="#ffffff" />
      <Environment
        resolution={environmentResolution ?? 2048}
        environmentIntensity={1.1}
        preset="studio"
        blur={1}
      >
        <Lightformer
          form="rect"
          intensity={4}
          color="#ffffff"
          rotation-x={Math.PI / 2}
          position={[0, 6, -1]}
          scale={[14, 10, 1]}
        />
        <Lightformer
          form="ring"
          intensity={3}
          color="#f5f8ff"
          rotation-y={Math.PI / 2}
          position={[7, 0, 2]}
          scale={5}
        />
        <Lightformer
          form="circle"
          intensity={2}
          color="#ffffff"
          position={[0, -5, 4]}
          scale={7}
        />
      </Environment>
    </>
  );
}

const MOUSE_SMOOTHING = {
  header: { pointer: 10, rotation: 7, yaw: 0.42, pitch: 0.3 },
  icon: { pointer: 10, rotation: 7, yaw: 0.42, pitch: 0.3 },
  iconX: { pointer: 10, rotation: 7, yaw: 0.42, pitch: 0.3 },
  hero: { pointer: 12, rotation: 8, yaw: 0.55, pitch: 0.38 },
} as const satisfies Record<LogoVariant, { pointer: number; rotation: number; yaw: number; pitch: number }>;

function damp(current: number, target: number, lambda: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}

/** Stop the render loop when the tab is hidden. */
function PauseWhenHidden({ continuous }: { continuous: boolean }) {
  const setFrameloop = useThree((state) => state.setFrameloop);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const sync = () => {
      if (document.hidden) {
        setFrameloop("never");
      } else {
        setFrameloop(continuous ? "always" : "demand");
        invalidate();
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [continuous, setFrameloop, invalidate]);

  return null;
}

/** Demand-mode canvases still need explicit invalidates after async assets load. */
function StaticLogoSync() {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    invalidate();
    const timeouts = [100, 300, 600].map((ms) =>
      window.setTimeout(() => invalidate(), ms),
    );
    return () => timeouts.forEach(clearTimeout);
  }, [invalidate]);

  return null;
}

function MouseLook({
  children,
  variant,
  hoverDrivenMotion = false,
}: {
  children: React.ReactNode;
  variant: LogoVariant;
  hoverDrivenMotion?: boolean;
}) {
  const groupRef = useRef<Group>(null);
  const smoothPointer = useRef({ x: 0, y: 0 });
  const rotation = useRef({ x: 0, y: 0 });
  const globalPointer = useRef({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  const invalidate = useThree((state) => state.invalidate);
  const settings = MOUSE_SMOOTHING[variant];
  const trackGlobally = variant === "hero";

  useEffect(() => {
    if (!trackGlobally) return;

    const onPointerMove = (event: PointerEvent) => {
      globalPointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      globalPointer.current.y = -(event.clientY / window.innerHeight) * 2 + 1;
    };

    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [trackGlobally]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const dt = Math.min(delta, 0.05);
    const { pointer } = state;

    const pointerTargetX = trackGlobally
      ? globalPointer.current.x
      : hovered
        ? pointer.x
        : 0;
    const pointerTargetY = trackGlobally
      ? globalPointer.current.y
      : hovered
        ? pointer.y
        : 0;

    smoothPointer.current.x = damp(
      smoothPointer.current.x,
      pointerTargetX,
      settings.pointer,
      dt,
    );
    smoothPointer.current.y = damp(
      smoothPointer.current.y,
      pointerTargetY,
      settings.pointer,
      dt,
    );

    const targetY = smoothPointer.current.x * settings.yaw;
    const targetX = -smoothPointer.current.y * settings.pitch;

    rotation.current.y = damp(
      rotation.current.y,
      targetY,
      settings.rotation,
      dt,
    );
    rotation.current.x = damp(
      rotation.current.x,
      targetX,
      settings.rotation,
      dt,
    );

    group.rotation.y = rotation.current.y;
    group.rotation.x = rotation.current.x;

    if (!hoverDrivenMotion) return;

    const animating =
      hovered ||
      Math.abs(rotation.current.x) > MOTION_EPS ||
      Math.abs(rotation.current.y) > MOTION_EPS ||
      Math.abs(smoothPointer.current.x) > MOTION_EPS ||
      Math.abs(smoothPointer.current.y) > MOTION_EPS;
    if (animating) invalidate();
  });

  return (
    <group
      ref={groupRef}
      {...(!trackGlobally && {
        onPointerOver: (e) => {
          e.stopPropagation();
          setHovered(true);
          if (hoverDrivenMotion) invalidate();
        },
        onPointerOut: (e) => {
          e.stopPropagation();
          setHovered(false);
          if (hoverDrivenMotion) invalidate();
        },
      })}
    >
      {children}
    </group>
  );
}

function roundTextGeometry(geometry: BufferGeometry, passes: number) {
  laplacianSmoothGeometry(geometry, passes, 0.38);
}

function GxTextMark({ config }: { config: LogoVariantConfig }) {
  const meshRef = useRef<Mesh>(null);
  const fitRef = useRef<Group>(null);
  const label = config.glyph;

  useLayoutEffect(() => {
    const geometry = meshRef.current?.geometry as BufferGeometry | undefined;
    if (!geometry) return;
    roundTextGeometry(geometry, config.smoothPasses);
  }, [config]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    const fit = fitRef.current;
    if (!config.squareFit || !mesh || !fit) return;

    const box = new Box3().setFromObject(mesh);
    const size = box.getSize(new Vector3());
    const halfFov = (config.camera.fov * Math.PI) / 360;
    const padding = config.squareFitPadding ?? 0.86;
    const viewPlane =
      2 * config.camera.position[2] * Math.tan(halfFov) * padding;
    const scale = Math.min(
      viewPlane / Math.max(size.x, 0.001),
      viewPlane / Math.max(size.y, 0.001),
    );
    fit.scale.setScalar(scale);
  }, [config]);

  const text = (
    <Text3D
      ref={meshRef}
      font={BLOB_FONT}
      size={config.textSize}
      height={config.textHeight}
      curveSegments={72}
      bevelEnabled
      bevelThickness={config.bevelThickness}
      bevelSize={config.bevelSize}
      bevelOffset={0}
      bevelSegments={40}
      letterSpacing={label === "x" ? 0 : -0.01}
      smooth={0.06}
    >
      {label}
      <SplineChrome />
    </Text3D>
  );

  if (config.squareFit) {
    return (
      <Center>
        <group ref={fitRef}>{text}</group>
      </Center>
    );
  }

  return <Center>{text}</Center>;
}

function GxLogoMark({ config }: { config: LogoVariantConfig }) {
  if (USE_GX_LOGO_MESH) {
    return <GxGlbModel config={config} />;
  }
  return (
    <Center>
      <GxTextMark config={config} />
    </Center>
  );
}

function defaultEnvironmentResolution(variant: LogoVariant) {
  if (variant === "icon" || variant === "iconX") {
    return ICON_ENVIRONMENT_RESOLUTION;
  }
  if (variant === "header") return HEADER_ENVIRONMENT_RESOLUTION;
  if (variant === "hero") return HERO_ENVIRONMENT_RESOLUTION;
  return 2048;
}

export function GxLogoScene({
  variant = "header",
  interactive = true,
  hoverDrivenMotion = false,
  environmentResolution,
}: GxLogoSceneProps) {
  const config = getLogoConfig(variant);
  const isHero = variant === "hero";
  const envResolution =
    environmentResolution ?? defaultEnvironmentResolution(variant);
  const mark = <GxLogoMark config={config} />;

  const content =
    interactive && isHero ? (
      <Float speed={1.4} rotationIntensity={0.015} floatIntensity={0.04}>
        {mark}
      </Float>
    ) : (
      mark
    );

  return (
    <>
      <SplineLighting
        variant={variant}
        environmentResolution={envResolution}
      />
      {interactive ? (
        <>
          <PauseWhenHidden continuous={isHero} />
          <MouseLook variant={variant} hoverDrivenMotion={hoverDrivenMotion}>
            {content}
          </MouseLook>
        </>
      ) : (
        content
      )}
      {!interactive ? <StaticLogoSync /> : null}
    </>
  );
}

export function configureGxLogoRenderer(
  gl: WebGLRenderer,
  variant: LogoVariant = "header",
) {
  gl.outputColorSpace = SRGBColorSpace;
  gl.toneMapping = ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.3;
}
