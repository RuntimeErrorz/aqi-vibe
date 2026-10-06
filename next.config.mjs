/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NEXT_EXPORT === "true" ? "export" : undefined,
  images: {
    unoptimized: true,
  },
  reactStrictMode: false, // Prevents Leaflet multiple map instance initialization in dev
  env: {
    NEXT_PUBLIC_WAQI_TOKEN: process.env.NEXT_PUBLIC_WAQI_TOKEN || "50b0c272a11f35667dd0ef7de354d76e9560ac48",
  },
};

export default nextConfig;
