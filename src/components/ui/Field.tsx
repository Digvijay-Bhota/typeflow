import type { ReactNode } from "react";
import { cn } from "./cn";
import { Label } from "./Input";

/** What Field passes to its control so the label, hint and error are announced with it. */
export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

type FieldProps = {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Shows a required marker; also set `required` on the control itself. */
  required?: boolean;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
};

/**
 * Label + control + hint + error, wired together:
 *   <Field id="email" label="Email" error={errors.email}>
 *     {(control) => <Input type="email" required {...control} />}
 *   </Field>
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger ml-0.5">
            *
          </span>
        )}
      </Label>
      {children({
        id,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(error ? { "aria-invalid": true as const } : {}),
      })}
      {hint && (
        <p id={hintId} className="text-muted text-sm">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-danger text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
