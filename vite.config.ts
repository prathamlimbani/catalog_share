import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // `--mode app` (see .env.app) builds the bundle that ships inside the Android
  // APK. It differs from the website build in one important way: the
  // platform-owner console is replaced with a stub so its code, its RPC names
  // and its destructive actions are never shipped to end users' devices.
  const isAppBuild = mode === "app";

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react()],
    resolve: {
      alias: [
        { find: "@", replacement: path.resolve(__dirname, "./src") },
        // Aliasing at resolve time is what actually removes the chunk. A
        // runtime `if` around a lazy import still leaves Rollup emitting it.
        ...(isAppBuild
          ? [
              {
                find: /^\.\/pages\/MasterAdmin$/,
                replacement: path.resolve(__dirname, "./src/pages/_excluded.tsx"),
              },
              {
                find: /^\.\/pages\/MasterLogin$/,
                replacement: path.resolve(__dirname, "./src/pages/_excluded.tsx"),
              },
            ]
          : []),
      ],
    },
    build: {
      // Android WebView on minSdk 24 is Chromium 60+ once updated, but OEM
      // builds lag; es2019 is the safe floor that still keeps the bundle small.
      target: "es2019",
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks: {
            "vendor-supabase": ["@supabase/supabase-js"],
            "vendor-radix": [
              "@radix-ui/react-dialog",
              "@radix-ui/react-dropdown-menu",
              "@radix-ui/react-select",
              "@radix-ui/react-tooltip",
              "@radix-ui/react-switch",
              "@radix-ui/react-tabs",
              "@radix-ui/react-toast",
            ],
            "vendor-router": ["react-router-dom"],
            ...(isAppBuild ? {} : { "vendor-charts": ["recharts"] }),
          },
        },
      },
    },
  };
});
