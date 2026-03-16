import type { Config } from "tailwindcss";
import nativewind from "nativewind/preset";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  presets: [nativewind],
  theme: {
    extend: {}
  }
};

export default config;

