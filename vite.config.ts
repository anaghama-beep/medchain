import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "frontend",
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: { ethers: ["ethers"], react: ["react", "react-dom"] } } },
  },
  test: { root: "." },
});
