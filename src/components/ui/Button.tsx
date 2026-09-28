import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

type VariantProps = {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
};

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium " +
  "transition-colors duration-(--duration-fast) ease-standard " +
  "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

// Hover darkens the fill slightly, which keeps (or raises) text contrast in both themes.
const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-foreground hover:bg-[color-mix(in_oklab,var(--accent)_90%,black)]",
  secondary:
    "border border-border-strong bg-surface text-foreground hover:bg-surface-muted",
  ghost: "text-foreground hover:bg-surface-muted",
  danger:
    "bg-danger text-danger-foreground hover:bg-[color-mix(in_oklab,var(--color-danger)_90%,black)]",
  link: "rounded-sm text-accent underline-offset-4 hover:underline",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

/** Class names for a button look, for elements that are not <Button> or <ButtonLink>. */
export function buttonVariants({
  variant = "primary",
  size = "md",
  className,
}: VariantProps & { className?: string | undefined } = {}): string {
  return cn(base, variants[variant], variant === "link" ? "p-0" : sizes[size], className);
}

type ButtonProps = ComponentProps<"button"> &
  VariantProps & {
    /** Shows a spinner, disables the button and marks it busy; the label stays. */
    loading?: boolean;
  };

export function Button({
  variant,
  size,
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonVariants({ variant, size, className })}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & VariantProps;

/** Navigation that looks like a button (a real link: middle-click, prefetch, no JS needed). */
export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <Link className={buttonVariants({ variant, size, className })} {...props} />;
}
