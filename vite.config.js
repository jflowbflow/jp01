import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  preview: {
    allowedHosts: true,
  },
}));
