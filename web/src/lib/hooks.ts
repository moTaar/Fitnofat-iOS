import { useEffect, useState } from "react";
import { useStore } from "./store";

/** Applies the persisted theme to <html> and returns a toggle. */
export function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  const setSetting = useStore((s) => s.setSetting);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", theme === "dark" ? "#0a0a0b" : "#ffffff");
  }, [theme]);

  return {
    theme,
    toggle: () => setSetting("theme", theme === "dark" ? "light" : "dark"),
  };
}

/** Live online/offline status. */
export function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Re-renders every `intervalMs` while `active`, returning Date.now(). */
export function useNow(active: boolean, intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
