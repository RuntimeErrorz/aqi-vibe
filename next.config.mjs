/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  reactStrictMode: false, // Prevents Leaflet multiple map instance initialization in dev
  env: {
    NEXT_PUBLIC_WAQI_TOKEN: process.env.NEXT_PUBLIC_WAQI_TOKEN || "",
    NEXT_PUBLIC_CARTO_KEY: process.env.NEXT_PUBLIC_CARTO_KEY || "",
  },
};

export default nextConfig;
