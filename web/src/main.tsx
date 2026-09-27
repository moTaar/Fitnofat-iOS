import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { setupPWA } from "./lib/pwa";
import { initAuth } from "./lib/api";
import { isNative } from "./lib/platform";

// Register the service worker (installable + offline) — browser only. The iOS
// app ships its assets inside the bundle and updates through new builds, and
// WKWebView doesn't run service workers on the app's custom scheme anyway.
// No-op in dev.
if (!isNative()) setupPWA();

// The session is read before the first render: on iOS it lives in native
// Preferences, which is asynchronous, and the router decides between the app
// and the login screen synchronously.
void initAuth().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
});
