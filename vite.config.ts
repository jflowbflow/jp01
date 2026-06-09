import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "/jp01/",
  build: {
    rollupOptions: {
      input: {
        index: "index.source.html",
      },
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
});
