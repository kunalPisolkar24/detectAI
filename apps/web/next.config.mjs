/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@workspace/ui"],
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth"],
  },
}

export default nextConfig
