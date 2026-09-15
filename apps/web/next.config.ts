import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatar.vercel.sh",
      },
    ],
  },
  serverExternalPackages: ["@grpc/grpc-js", "@grpc/proto-loader", "@opentelemetry/sdk-node", "@opentelemetry/exporter-trace-otlp-http", "@opentelemetry/auto-instrumentations-node"],
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;