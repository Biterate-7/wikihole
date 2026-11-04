import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Wikipedia media is served exclusively from upload.wikimedia.org. Everything
// else the browser talks to is this origin (all Wikipedia API calls are proxied
// through our route handlers so the User-Agent policy and caching are enforced
// server-side).
const csp = [
  "default-src 'self'",
  "img-src 'self' data: https://upload.wikimedia.org https://thumb.wikimedia.org",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The discovery snapshot is read from disk at runtime, so serverless bundles must include it.
  outputFileTracingIncludes: {
    "/discover/**": ["./data/snapshot/**"],
    "/api/curated": ["./data/snapshot/**"],
    "/api/contextual": ["./data/snapshot/**"],
    "/wiki/**": ["./data/snapshot/**"],
  },
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "upload.wikimedia.org" },
      { protocol: "https", hostname: "thumb.wikimedia.org" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
