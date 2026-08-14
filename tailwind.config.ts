import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Design system tokens from spec
        background:   "#0B0B0F",
        surface:      "#17171C",
        "surface-alt":"#212127",
        accent:       "#4F8CFF",
        "text-primary":  "#FFFFFF",
        "text-secondary": "#A0A0AB",
        danger:       "#FF5C5C",
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      fontSize: {
        // 14px mobile base, 16px desktop
        base: ["14px", { lineHeight: "1.5" }],
      },
      screens: {
        // spec breakpoints
        sm: "640px",
        md: "768px",
        lg: "1024px",
      },
    },
  },
  plugins: [],
};

export default config;
