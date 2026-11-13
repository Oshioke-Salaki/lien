import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The deployment records live outside the app so the ops scripts own them.
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  // The landing page is a static page built on its own design system (public/site); the app is everything else.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/site/index.html" }], afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
