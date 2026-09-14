import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The pg driver and the argon2 native binding must be required at runtime by
  // Node, never bundled into the server build.
  serverExternalPackages: ["pg", "@node-rs/argon2"],
};

export default nextConfig;
