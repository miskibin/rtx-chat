import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "8000",
        pathname: "/artifacts/**",
      },
      {
        protocol: "http",
        hostname: "backend",
        port: "8000",
        pathname: "/artifacts/**",
      },
    ],
  },
};

export default nextConfig;
