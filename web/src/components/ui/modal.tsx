import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Render as a bottom sheet (mobile-friendly) instead of a centered dialog. */
  sheet?: boolean;
  className?: string;
}

export function Modal({ open, onClose, title, children, sheet = true, className }: ModalProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm animate-fade-in"
      style={{ alignItems: sheet ? "flex-end" : "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative w-full bg-card text-card-foreground border-border",
          sheet
            ? "rounded-t-3xl border-t max-h-[90vh] animate-slide-up safe-bottom"
            : "rounded-2xl border max-w-md mx-4 animate-scale-in max-h-[90vh]",
          "overflow-y-auto no-scrollbar shadow-2xl",
          className
        )}
      >
        {sheet && (
          <div className="sticky top-0 flex justify-center pt-3 pb-1 bg-card">
            <div className="h-1.5 w-10 rounded-full bg-muted" />
          </div>
        )}
        {title && (
          <div className="flex items-center justify-between px-5 pt-3 pb-2">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded-full p-1.5 hover:bg-accent tap">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className="px-5 pb-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
