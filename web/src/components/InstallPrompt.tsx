import { useEffect, useState } from "react";
import { Download, Share, Plus, X } from "lucide-react";
import { Button } from "./ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "forgefit-install-dismissed";

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-expect-error iOS Safari
    window.navigator.standalone === true
  );
}

function isIOS() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !/crios|fxios/i.test(navigator.userAgent)
  );
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // iOS has no beforeinstallprompt — surface manual instructions.
    if (isIOS()) {
      const t = setTimeout(() => setShow(true), 2500);
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", handler);
      };
    }
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    setShow(false);
    setIosHelp(false);
    localStorage.setItem(DISMISS_KEY, "1");
  };

  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") dismiss();
      else setShow(false);
    } else if (isIOS()) {
      setIosHelp(true);
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(var(--dock-height,4rem)_+_0.75rem)] z-40 mx-auto max-w-md px-4 animate-slide-up">
      <div className="rounded-2xl border border-border bg-card/95 p-4 shadow-2xl backdrop-blur">
        {!iosHelp ? (
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/15 p-2 text-primary">
              <Download className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="font-semibold leading-tight">Install ForgeFit</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Add to your home screen for instant, offline access on the gym floor.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={install} className="flex-1">
                  {isIOS() ? "How to install" : "Install app"}
                </Button>
                <Button size="sm" variant="ghost" onClick={dismiss}>
                  Not now
                </Button>
              </div>
            </div>
            <button onClick={dismiss} className="rounded-full p-1 hover:bg-accent tap">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold">Add to Home Screen</p>
              <button onClick={dismiss} className="rounded-full p-1 hover:bg-accent tap">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <span className="font-semibold text-foreground">1.</span> Tap the
                <Share className="inline h-4 w-4" /> Share button in Safari.
              </li>
              <li className="flex items-center gap-2">
                <span className="font-semibold text-foreground">2.</span> Choose
                <Plus className="inline h-4 w-4" /> “Add to Home Screen”.
              </li>
              <li className="flex items-center gap-2">
                <span className="font-semibold text-foreground">3.</span> Tap “Add” — done!
              </li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
