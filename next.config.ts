import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const withNextIntl = createNextIntlPlugin("./i18n/request.ts")

const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
})

const nextConfig: NextConfig = withBundleAnalyzer({
  output: "standalone",
  async headers() {
    return [
      {
        source: "/download",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/api/download",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ]
  },
  async rewrites() {
    // Map well-known agent-discovery paths onto Next.js route handlers.
    // Convention: external surface uses the standardized path (e.g.
    // /.well-known/openapi.json per Stripe/Anthropic); the implementation
    // lives at /api/<name> so route-collision and tooling stay clean.
    return [
      { source: "/.well-known/openapi.json", destination: "/api/openapi" },
      { source: "/openapi.json", destination: "/api/openapi" },
      { source: "/.well-known/mcp/server-card.json", destination: "/api/mcp-server-card" },
      { source: "/.well-known/ai-plugin.json", destination: "/api/ai-plugin" },
    ]
  },
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react"],
  },
  serverExternalPackages: ["shiki", "vscode-oniguruma", "ssh2"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    domains: [
      'www.google.com',
      'img.youtube.com',
    ],
  },
  eslint: {
    // @todo: remove before going live
    ignoreDuringBuilds: true,
  },
})

export default withNextIntl(nextConfig)
