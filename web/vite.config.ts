import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Listen on all interfaces so a phone on the same LAN can load the app.
    host: true,
  },
  preview: { port: 4173, host: true },
});
