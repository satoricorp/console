"use client";

import { useLayoutEffect, useMemo } from "react";
import { Center, useGLTF } from "@react-three/drei";
import { Box3, MeshPhysicalMaterial, Vector3, type Mesh } from "three";

import { GX_MESH_PATH } from "./constants";
import type { LogoVariantConfig } from "./constants";

/** Correct Blender export orientation until rotation is applied in Blender. */
const BLENDER_MESH_ROTATION: [number, number, number] = [Math.PI, 0, 0];

function createChromeMaterial() {
  return new MeshPhysicalMaterial({
    color: "#e9edf7",
    metalness: 1,
    roughness: 0.04,
    clearcoat: 1,
    clearcoatRoughness: 0.015,
    envMapIntensity: 1.85,
  });
}

type GxGlbModelProps = {
  config: LogoVariantConfig;
};

export function GxGlbModel({ config }: GxGlbModelProps) {
  const { scene } = useGLTF(GX_MESH_PATH);
  const { model, scale } = useMemo(() => {
    const clone = scene.clone(true);
    clone.rotation.set(...BLENDER_MESH_ROTATION);
    clone.updateMatrixWorld(true);

    const box = new Box3().setFromObject(clone);
    const center = box.getCenter(new Vector3());
    clone.position.sub(center);
    clone.updateMatrixWorld(true);

    const sizedBox = new Box3().setFromObject(clone);
    const size = sizedBox.getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const variantScale = config.textSize / 1.48;
    const fitScale =
      (config.targetMaxDimension / maxDim) * variantScale;

    return { model: clone, scale: fitScale };
  }, [scene, config.textSize, config.targetMaxDimension]);

  useLayoutEffect(() => {
    const chrome = createChromeMaterial();
    model.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      mesh.material = chrome;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
  }, [model]);

  return (
    <Center>
      <primitive object={model} scale={scale} />
    </Center>
  );
}

useGLTF.preload(GX_MESH_PATH);
