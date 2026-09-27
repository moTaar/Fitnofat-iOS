// Generates the iOS app icon and launch-screen images from the same dumbbell
// mark as the PWA icons (generate-icons.mjs), replacing Capacitor's
// placeholders in ios/App/App/Assets.xcassets. Zero dependencies.
//
//   node scripts/generate-ios-assets.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { encodePNG, render } from "./generate-icons.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(__dirname, "../ios/App/App/Assets.xcassets");

// App icon: 1024×1024, opaque. iOS applies the rounded mask itself, so the
// mark uses the maskable (inset) layout to stay clear of the corners.
const icon = encodePNG(1024, render(1024, { maskable: true }), { alpha: false });
writeFileSync(path.join(ASSETS, "AppIcon.appiconset/AppIcon-512@2x.png"), icon);
console.log("wrote AppIcon-512@2x.png", icon.length, "bytes");

// Launch screen: the app's dark background with the icon centred, matching
// the in-app splash so launch → first paint doesn't flash.
const SPLASH = 2732;
const MARK = 560;
const RADIUS = MARK * 0.225;
const bg = [0x0a, 0x0a, 0x0b];
const mark = render(MARK, { maskable: true });
const splash = Buffer.alloc(SPLASH * SPLASH * 4);
const off = Math.round((SPLASH - MARK) / 2);
for (let y = 0; y < SPLASH; y++) {
  for (let x = 0; x < SPLASH; x++) {
    const i = (y * SPLASH + x) * 4;
    let [r, g, b] = bg;
    const mx = x - off;
    const my = y - off;
    if (mx >= 0 && my >= 0 && mx < MARK && my < MARK) {
      // Rounded-square clip, like the icon on the home screen.
      const dx = Math.max(RADIUS - mx, mx - (MARK - 1 - RADIUS), 0);
      const dy = Math.max(RADIUS - my, my - (MARK - 1 - RADIUS), 0);
      if (dx * dx + dy * dy <= RADIUS * RADIUS) {
        const j = (my * MARK + mx) * 4;
        [r, g, b] = [mark[j], mark[j + 1], mark[j + 2]];
      }
    }
    splash[i] = r;
    splash[i + 1] = g;
    splash[i + 2] = b;
    splash[i + 3] = 255;
  }
}
const splashPng = encodePNG(SPLASH, splash, { alpha: false });
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  writeFileSync(path.join(ASSETS, "Splash.imageset", name), splashPng);
  console.log("wrote", name, splashPng.length, "bytes");
}
