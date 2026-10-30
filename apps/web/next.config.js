const apiUrl = new URL(process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000");
if (
  !["http:", "https:"].includes(apiUrl.protocol) ||
  apiUrl.username ||
  apiUrl.password ||
  apiUrl.pathname !== "/" ||
  apiUrl.search ||
  apiUrl.hash
) {
  throw new Error(
    "API_INTERNAL_URL must be an HTTP(S) origin without credentials, path, or query.",
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: process.env.APP_URL
    ? [new URL(process.env.APP_URL).hostname]
    : [],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.googleusercontent.com" },
    ],
  },
  transpilePackages: ["@repo/ui"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl.origin}/:path*` }];
  },
};

export default nextConfig;
