"use client";

import { useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import {
  LinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Mesh,
  type Texture,
} from "three";

const NEBULA_TEXTURE = "/footer-art/horsehead-nebula.png";

type WanderState = {
  offsetX: number;
  offsetY: number;
  rotation: number;
  meshX: number;
  meshY: number;
  meshRot: number;
  targetOffsetX: number;
  targetOffsetY: number;
  targetRotation: number;
  targetMeshX: number;
  targetMeshY: number;
  targetMeshRot: number;
  wanderSpeed: number;
};

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function shortestOffsetDelta(from: number, to: number) {
  let delta = to - from;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

function approach(current: number, target: number, maxDelta: number) {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

function pickWanderTargets(state: WanderState) {
  state.targetOffsetX = randomBetween(0, 1);
  state.targetOffsetY = randomBetween(0, 1);
  state.targetRotation = randomBetween(-0.14, 0.14);
  state.targetMeshX = randomBetween(-0.12, 0.12);
  state.targetMeshY = randomBetween(-0.08, 0.08);
  state.targetMeshRot = randomBetween(-0.05, 0.05);
  state.wanderSpeed = randomBetween(0.12, 0.38);
}

function createWanderState(): WanderState {
  const state: WanderState = {
    offsetX: randomBetween(0, 1),
    offsetY: randomBetween(0, 1),
    rotation: randomBetween(-0.1, 0.1),
    meshX: 0,
    meshY: 0,
    meshRot: 0,
    targetOffsetX: 0,
    targetOffsetY: 0,
    targetRotation: 0,
    targetMeshX: 0,
    targetMeshY: 0,
    targetMeshRot: 0,
    wanderSpeed: 0.25,
  };
  pickWanderTargets(state);
  return state;
}

function isNearTarget(current: number, target: number, threshold: number) {
  return Math.abs(target - current) <= threshold;
}

function configureTexture(texture: Texture) {
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
}

export function AsciiFooterScene() {
  const meshRef = useRef<Mesh>(null);
  const wanderRef = useRef<WanderState | null>(null);
  if (!wanderRef.current) {
    wanderRef.current = createWanderState();
  }

  const texture = useTexture(NEBULA_TEXTURE);
  const viewport = useThree((state) => state.viewport);

  useLayoutEffect(() => {
    configureTexture(texture);
  }, [texture]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    const wander = wanderRef.current;
    if (!mesh || !wander) return;

    const step = wander.wanderSpeed * delta;

    wander.offsetX = wrap01(
      wander.offsetX +
        shortestOffsetDelta(wander.offsetX, wander.targetOffsetX) * step,
    );
    wander.offsetY = wrap01(
      wander.offsetY +
        shortestOffsetDelta(wander.offsetY, wander.targetOffsetY) * step,
    );
    wander.rotation = approach(wander.rotation, wander.targetRotation, step * 0.35);
    wander.meshX = approach(wander.meshX, wander.targetMeshX, step * 0.25);
    wander.meshY = approach(wander.meshY, wander.targetMeshY, step * 0.25);
    wander.meshRot = approach(wander.meshRot, wander.targetMeshRot, step * 0.3);

    const offsetDone =
      Math.abs(shortestOffsetDelta(wander.offsetX, wander.targetOffsetX)) < 0.015 &&
      Math.abs(shortestOffsetDelta(wander.offsetY, wander.targetOffsetY)) < 0.015;
    const poseDone =
      isNearTarget(wander.rotation, wander.targetRotation, 0.01) &&
      isNearTarget(wander.meshX, wander.targetMeshX, 0.01) &&
      isNearTarget(wander.meshY, wander.targetMeshY, 0.01) &&
      isNearTarget(wander.meshRot, wander.targetMeshRot, 0.008);

    if (offsetDone && poseDone) {
      pickWanderTargets(wander);
    }

    texture.offset.set(wander.offsetX, wander.offsetY);
    texture.rotation = wander.rotation;
    mesh.position.set(wander.meshX, wander.meshY, 0);
    mesh.rotation.z = wander.meshRot;
  });

  const image = texture.image;
  const imageAspect =
    image instanceof HTMLImageElement && image.width > 0
      ? image.width / image.height
      : 16 / 9;
  const containerAspect = viewport.width / viewport.height;
  const planeWidth =
    imageAspect > containerAspect
      ? viewport.height * imageAspect
      : viewport.width;
  const planeHeight =
    imageAspect > containerAspect
      ? viewport.height
      : viewport.width / imageAspect;

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[planeWidth, planeHeight, 1, 1]} />
      <meshBasicMaterial
        map={texture}
        toneMapped={false}
        onBeforeCompile={(shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <map_fragment>",
            `#include <map_fragment>
            float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            diffuseColor.rgb = vec3(luma);`,
          );
        }}
      />
    </mesh>
  );
}

function wrap01(value: number) {
  return value - Math.floor(value);
}

useTexture.preload(NEBULA_TEXTURE);
