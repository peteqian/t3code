import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.t3code.companion",
  appName: "T3 Companion",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  ios: {
    deploymentTarget: "26.4",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#0a0a0a",
    },
  },
};

export default config;
