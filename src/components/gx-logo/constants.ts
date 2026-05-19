/**
 * Single source of truth for gx logo sizing.
 * Tune container (CSS rem) and camera together.
 */

export const GX_MESH_PATH = "/models/gx-chrome.glb";

export const USE_GX_LOGO_MESH =
  process.env.NEXT_PUBLIC_GX_LOGO_MESH === "true";

function splinePill(textSize: number) {
  return {
    textSize,
    textHeight: textSize * 0.06,
    bevelThickness: textSize * 0.3,
    bevelSize: textSize * 0.14,
    smoothPasses: 2 as const,
  };
}

type CameraConfig = {
  position: [number, number, number];
  fov: number;
};

type ContainerConfig = {
  widthRem: number;
  heightRem: number;
  maxWidthRem?: number;
};

export type LogoVariantConfig = ContainerConfig & {
  camera: CameraConfig;
  /** Scene units — max axis after centering; header uses smaller fit. */
  targetMaxDimension: number;
  textSize: number;
  textHeight: number;
  bevelThickness: number;
  bevelSize: number;
  smoothPasses: number;
};

function defineVariant(
  container: ContainerConfig,
  camera: CameraConfig,
  textSize: number,
  targetMaxDimension: number,
): LogoVariantConfig {
  return {
    ...container,
    camera,
    targetMaxDimension,
    ...splinePill(textSize),
  };
}

export const LOGO_VARIANTS = {
  header: defineVariant(
    { widthRem: 10.75, heightRem: 3.35 },
    { position: [0, 0, 2.55], fov: 28 },
    1.22,
    1.88,
  ),
  hero: defineVariant(
    { widthRem: 24, heightRem: 14, maxWidthRem: 26 },
    { position: [0, 0, 3.05], fov: 32 },
    1.72,
    1.92,
  ),
} as const satisfies Record<string, LogoVariantConfig>;

export type LogoVariant = keyof typeof LOGO_VARIANTS;

export function getLogoConfig(variant: LogoVariant = "header") {
  return LOGO_VARIANTS[variant];
}

export const HEADER_LOGO = LOGO_VARIANTS.header;
export const HERO_LOGO = LOGO_VARIANTS.hero;
