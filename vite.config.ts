import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "/",
  preview: {
    host: true,
    allowedHosts: true,
  },
});
