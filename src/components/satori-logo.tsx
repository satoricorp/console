type SatoriLogoProps = {
  height?: number;
  className?: string;
};

export function SatoriLogo({ height = 16, className }: SatoriLogoProps) {
  const width = Math.round((1024 / 69) * height);

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 1024 69"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Satori Engineering Co."
      role="img"
      className={className}
    >
      <circle cx="36" cy="34.5" r="27" fill="var(--footer-link-hover)" />
      <text
        x="76"
        y="46"
        fill="var(--footer-link-hover)"
        fontFamily="'Courier New', Courier, monospace"
        fontSize="36"
        letterSpacing="-0.02em"
      >
        Satori Engineering Co.
      </text>
    </svg>
  );
}
