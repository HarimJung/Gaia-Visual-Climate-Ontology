// Static output only (AD-6 / P-F10): no server runtime, no SSR adapter, no WebGL.
// Core content is server-generated HTML, readable with JavaScript disabled.
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  devToolbar: { enabled: false },
});
