/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  reactStrictMode: false, // Prevents Leaflet multiple map instance initialization in dev
  env: {
    NEXT_PUBLIC_WAQI_TOKEN: process.env.NEXT_PUBLIC_WAQI_TOKEN || "50b0c272a11f35667dd0ef7de354d76e9560ac48",
    NEXT_PUBLIC_CARTO_KEY: process.env.NEXT_PUBLIC_CARTO_KEY || "cb1_4bl6_1_dc1bbfd8426369beb577afe4",
  },
};

export default nextConfig;
