import type { NextConfig } from "next";

const config: NextConfig = {
   ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  poweredByHeader: false,
  experimental: {
    ...(process.env.DAR_LOCAL_BUILD === "true" ? { cpus: 1 } : {}),
    serverActions: { bodySizeLimit: "16kb" },
  },
  async redirects() {
    return [{ source: "/", destination: "/ar", permanent: false }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
      ],
    }, {
      source: "/:locale(ar|en)/dashboard/stores/:slug/design/preview",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'" },
        { key: "Cache-Control", value: "private, no-store" },
      ],
    }];
  },
};

export default config;
