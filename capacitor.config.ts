import type { CapacitorConfig } from "@capacitor/cli";

/**
 * CatalogShare — Android app shell configuration.
 *
 * appId is PERMANENT once the app is published to Google Play. Do not change it.
 */
const config: CapacitorConfig = {
  appId: "in.catalogshare.app",
  appName: "CatalogShare",
  webDir: "dist",

  // Serve the bundled web app over https://localhost so that secure-context
  // APIs (crypto, clipboard, service workers) and Supabase auth all behave
  // exactly as they do on the website.
  server: {
    androidScheme: "https",
  },

  android: {
    // Never allow http:// subresources — Play flags cleartext traffic.
    allowMixedContent: false,
    captureInput: true,
    // Flipped to true only by the debug build script.
    webContentsDebuggingEnabled: false,
    backgroundColor: "#0B1020",
  },

  plugins: {
    SplashScreen: {
      // The splash is a separate window held above the WebView by
      // setKeepOnScreenCondition(). With launchAutoHide false, the ONLY thing
      // that dismisses it is a JS call to hide() — so any failure to reach that
      // call leaves the user staring at the logo forever, which is exactly what
      // happened. autoHide is the native-side hard ceiling: Android dismisses it
      // on its own even if the web layer never boots at all. main.tsx still
      // hides it as soon as React paints, so this duration is a backstop, not
      // a delay the user normally sees.
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#0B1020",
      androidSplashResourceName: "splash",
      // FIT_CENTER, not CENTER_CROP: the source is square, so cropping it to a
      // tall phone blows the mark up and clips it.
      androidScaleType: "FIT_CENTER",
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0B1020",
      overlaysWebView: false,
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
    // We talk to Supabase through its own fetch client; leaving the native
    // HTTP bridge off keeps streaming + auth refresh behaviour identical to web.
    CapacitorHttp: {
      enabled: false,
    },
  },
};

export default config;
