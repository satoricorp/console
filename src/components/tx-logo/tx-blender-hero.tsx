"use client";

/**
 * Standalone hero TX blender / 3D chrome transition.
 * Preserved for reuse — the marketing hero no longer mounts this as the main logo.
 */
import { TxLogo, type TxLogoProps } from "./tx-logo";

export type TxBlenderHeroProps = Omit<TxLogoProps, "variant">;

export function TxBlenderHero({
  className,
  onReady,
  ...props
}: TxBlenderHeroProps) {
  return (
    <TxLogo
      variant="hero"
      className={className}
      onReady={onReady}
      {...props}
    />
  );
}
