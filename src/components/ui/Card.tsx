import type { ComponentProps } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-card border-border bg-surface text-foreground shadow-card border",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 p-6 pb-0", className)} {...props} />;
}

type CardTitleProps = ComponentProps<"h2"> & { as?: "h2" | "h3" };

export function CardTitle({ as: Heading = "h3", className, ...props }: CardTitleProps) {
  return (
    <Heading
      className={cn("text-lg font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-secondary text-sm", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-6", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-3 p-6 pt-0", className)} {...props} />;
}
