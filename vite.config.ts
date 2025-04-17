import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  // --- Configuration for the example app ---

  // Set the root for Vite to the 'example' directory.
  // This means index.html and source files are expected here.
  root: path.resolve(__dirname, 'example'),
  base: './',
  // Configure the development server
  server: {
    port: 3000, // Optional: Set a port (defaults to 5173)
    open: true,  // Automatically open the browser
    // host: true // Uncomment if you want to access from other devices on network
  },

  // Configure the build process for the example app
  build: {
    // Output directory relative to the 'root' option (i.e., example/dist)
    outDir: 'dist',
    sourcemap: false, // Generate source maps for the production build
    // Empty the output directory before building
    emptyOutDir: true,
  },

  // --- Resolve aliases to make imports cleaner ---
  resolve: {
    alias: {
      // Create an alias 'canvas-sheet' that points directly to your library's source entry point.
      // This gives the best development experience (like HMR working for library changes).
      'canvas-sheet': path.resolve(__dirname, 'src/index.ts'),

      // You could also create an alias for the whole src directory if needed:
      // '@lib': path.resolve(__dirname, 'src'),
    }
  }
});