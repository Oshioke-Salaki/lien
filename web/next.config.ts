import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The deployment records live outside the app so the ops scripts own them.
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
};

export default nextConfig;
