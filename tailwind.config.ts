import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        aqi: {
          good: "#10b981", // 优 - 绿
          moderate: "#eab308", // 良 - 黄
          unhealthySensitive: "#f97316", // 轻度 - 橙
          unhealthy: "#ef4444", // 中度 - 红
          veryUnhealthy: "#8b5cf6", // 重度 - 紫
          hazardous: "#7f1d1d", // 严重 - 褐红
        },
      },
    },
  },
  plugins: [],
};

export default config;
