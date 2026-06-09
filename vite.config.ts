import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "/jp01/",
  preview: {
    host: true,
    allowedHosts: true,
  },
});
