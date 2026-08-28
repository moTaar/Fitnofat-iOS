import { useEffect } from "react";
import { X, AlertCircle, CheckCircle, Info } from "lucide-react";
import { useToastStore } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="fixed bottom-[calc(var(--dock-height,4rem)_+_1rem)] left-0 right-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} {...t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({
  message,
  variant,
  onDismiss,
}: {
  id: string;
  message: string;
  variant: "default" | "error" | "success";
  onDismiss: () => void;
}) {
  useEffect(() => {
    return () => {};
  }, []);

  const Icon =
    variant === "error" ? AlertCircle : variant === "success" ? CheckCircle : Info;

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border px-4 py-3 shadow-2xl animate-slide-up",
        variant === "error"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : variant === "success"
          ? "border-success/30 bg-success/10 text-success"
          : "border-border bg-card text-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <p className="flex-1 text-sm font-medium">{message}</p>
      <button onClick={onDismiss} className="rounded-full p-0.5 hover:bg-black/10 tap">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
