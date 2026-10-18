// Static output only (AD-6 / P-F10): no server runtime, no SSR adapter, no WebGL.
// Core content is server-generated HTML, readable with JavaScript disabled.
import { defineConfig } from 'astro/config';

export default defineConfig({
  // The canonical origin. The build is root-relative, so this is a root
  // domain, not a project path; the deploy overrides it with SITE_ORIGIN.
  site: process.env.SITE_ORIGIN || 'https://www.visualclimate.org',
  output: 'static',
  devToolbar: { enabled: false },
});
