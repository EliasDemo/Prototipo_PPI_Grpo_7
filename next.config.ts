import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // gRPC y el Gateway de Fabric se cargan desde node_modules (no se empaquetan).
  serverExternalPackages: ["@hyperledger/fabric-gateway", "@grpc/grpc-js"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
