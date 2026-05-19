"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
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
import type { Group } from "three";

import {
  getLogoConfig,
  USE_GX_LOGO_MESH,
  type LogoVariant,
  type LogoVariantConfig,
} from "./constants";
import { GxGlbModel } from "./gx-glb-model";
import { laplacianSmoothGeometry } from "./round-geometry";

const BLOB_FONT = "/fonts/Blob-Regular.typeface.json";

if (!USE_GX_LOGO_MESH) {
  useFont.preload(BLOB_FONT);
}

type GxLogoSceneProps = {
  variant?: LogoVariant;
};

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

function SplineLighting() {
  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[8, 10, 12]} intensity={2.2} color="#ffffff" />
      <directionalLight position={[-10, 4, 8]} intensity={1.1} color="#d8e6ff" />
      <pointLight position={[0, 0, 10]} intensity={16} color="#ffffff" />
      <Environment resolution={2048} environmentIntensity={1.1} preset="studio" blur={1}>
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
  hero: { pointer: 12, rotation: 8, yaw: 0.55, pitch: 0.38 },
} as const;

function damp(current: number, target: number, lambda: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}

function MouseLook({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: LogoVariant;
}) {
  const groupRef = useRef<Group>(null);
  const smoothPointer = useRef({ x: 0, y: 0 });
  const rotation = useRef({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  const settings = MOUSE_SMOOTHING[variant];

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const dt = Math.min(delta, 0.05);
    const { pointer } = state;

    if (hovered) {
      smoothPointer.current.x = damp(
        smoothPointer.current.x,
        pointer.x,
        settings.pointer,
        dt,
      );
      smoothPointer.current.y = damp(
        smoothPointer.current.y,
        pointer.y,
        settings.pointer,
        dt,
      );
    } else {
      smoothPointer.current.x = damp(smoothPointer.current.x, 0, settings.pointer, dt);
      smoothPointer.current.y = damp(smoothPointer.current.y, 0, settings.pointer, dt);
    }

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
  });

  return (
    <group
      ref={groupRef}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        setHovered(false);
      }}
    >
      {children}
    </group>
  );
}

function roundTextGeometry(geometry: BufferGeometry, passes: number) {
  laplacianSmoothGeometry(geometry, passes, 0.38);
}

function GxTextFallback({ config }: { config: LogoVariantConfig }) {
  const meshRef = useRef<Mesh>(null);

  useLayoutEffect(() => {
    const geometry = meshRef.current?.geometry as BufferGeometry | undefined;
    if (!geometry) return;
    roundTextGeometry(geometry, config.smoothPasses);
  }, [config]);

  return (
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
      letterSpacing={-0.01}
      smooth={0.06}
    >
      gx
      <SplineChrome />
    </Text3D>
  );
}

function GxLogoMark({ config }: { config: LogoVariantConfig }) {
  if (USE_GX_LOGO_MESH) {
    return <GxGlbModel config={config} />;
  }
  return (
    <Center>
      <GxTextFallback config={config} />
    </Center>
  );
}

export function GxLogoScene({ variant = "header" }: GxLogoSceneProps) {
  const config = getLogoConfig(variant);
  const isHero = variant === "hero";
  const mark = <GxLogoMark config={config} />;

  return (
    <>
      <SplineLighting />
      <MouseLook variant={variant}>
        {isHero ? (
          <Float speed={1.4} rotationIntensity={0.015} floatIntensity={0.04}>
            {mark}
          </Float>
        ) : (
          mark
        )}
      </MouseLook>
    </>
  );
}

export function configureGxLogoRenderer(gl: WebGLRenderer) {
  gl.outputColorSpace = SRGBColorSpace;
  gl.toneMapping = ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.3;
}
