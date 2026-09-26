import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Strict mode for React 19
  reactStrictMode: true,

  // The certificate PDF font is read from disk at runtime (see
  // src/server/lib/certificateFonts.ts), so ship it with the functions that
  // render certificates.
  outputFileTracingIncludes: {
    "/api/payment/webhook": ["./src/server/assets/fonts/NotoSansDevanagari-Regular.ttf"],
    "/api/certificate/fulfill": [
      "./src/server/assets/fonts/NotoSansDevanagari-Regular.ttf",
    ],
  },

  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },

  // Image optimization
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },

  async rewrites() {
    return [
      {
        source: "/code/:language",
        destination: "/:language-typing-test",
      },
    ];
  },

  // Logging
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === "development",
    },
  },
};

export default nextConfig;
