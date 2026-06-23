import * as React from "react";
import { cn, haptic } from "@/lib/utils";

type Variant = "default" | "secondary" | "outline" | "ghost" | "destructive" | "success";
type Size = "default" | "sm" | "lg" | "icon" | "xl";

const variants: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  outline: "border border-border bg-transparent hover:bg-accent",
  ghost: "hover:bg-accent",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  success: "bg-success text-success-foreground hover:bg-success/90 shadow-sm",
};

const sizes: Record<Size, string> = {
  default: "h-11 px-4 text-sm",
  sm: "h-9 px-3 text-sm",
  lg: "h-12 px-6 text-base",
  xl: "h-14 px-8 text-base font-semibold",
  icon: "h-11 w-11",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", onClick, ...props }, ref) => {
    return (
      <button
        ref={ref}
        onClick={(e) => {
          haptic();
          onClick?.(e);
        }}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl font-medium tap",
          "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
