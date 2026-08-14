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
        background:   "#0F0F12",
        surface:      "#18181D",
        "surface-alt":"#23232A",
        accent:       "#E50914", // Netflix Red primary accent
        "accent-hover":"#F40612",
        "accent-blue": "#3B82F6",
        "text-primary":  "#FFFFFF",
        "text-secondary": "#A0A0AB",
        danger:       "#FF4D4D",
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      boxShadow: {
        'glow-red': '0 0 25px -5px rgba(229, 9, 20, 0.4)',
        'glow-subtle': '0 10px 30px -10px rgba(0, 0, 0, 0.8)',
      },
      fontSize: {
        base: ["14px", { lineHeight: "1.5" }],
      },
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
      },
    },
  },
  plugins: [],
};

export default config;
