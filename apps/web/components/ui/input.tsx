import type { DetailedHTMLProps, InputHTMLAttributes, ReactElement } from "react";
import { cn } from "../../lib/cn";

export function Input(
  props: DetailedHTMLProps<InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>
): ReactElement {
  const { className, ...rest } = props;
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...rest}
    />
  );
}
