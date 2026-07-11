import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX({
  configPath: "fuma.config.ts"
});

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true
};

export default withMDX(nextConfig);
