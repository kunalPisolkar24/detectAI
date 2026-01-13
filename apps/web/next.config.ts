import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@grpc/grpc-js", "@grpc/proto-loader"],
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatar.vercel.sh",
      },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;