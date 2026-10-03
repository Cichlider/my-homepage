import { defineConfig } from 'astro/config';

// GitHub Pages project site: https://cichlider.github.io/my-homepage/
export default defineConfig({
  site: 'https://cichlider.github.io',
  base: '/my-homepage',
  prefetch: { prefetchAll: true },
});
