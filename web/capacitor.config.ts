import type { CapacitorConfig } from "@capacitor/cli";

// The iOS app is this same React build (web/dist) running in a native shell.
// `npm run ios:sync` rebuilds it and copies it into ios/App; Xcode takes it
// from there. Setup and install steps: IOS.md at the repository root.
const config: CapacitorConfig = {
  // Must be unique on Apple's side. If Xcode reports the identifier is
  // unavailable for your team, change it here AND in Xcode's Signing tab.
  appId: "com.fitnofat.app",
  appName: "Fitnofat",
  webDir: "dist",
  ios: {
    // The layout already pads for the notch and home indicator with
    // env(safe-area-inset-*), so the web view spans the whole screen.
    contentInset: "never",
    backgroundColor: "#0a0a0b",
    // Swipe-back gestures fight the app's own bottom-sheet and swipe UI.
    allowsLinkPreview: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 400,
      launchAutoHide: true,
      backgroundColor: "#0a0a0b",
      showSpinner: false,
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
    LocalNotifications: {
      // Reminders tapped from the lock screen should also show if the app
      // happens to be open. The rest-over alert opts out per notification
      // (the in-app timer bar already beeps).
      presentationOptions: ["banner", "list", "sound"],
    },
  },
};

export default config;
