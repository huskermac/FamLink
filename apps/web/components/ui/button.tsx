import type { ButtonHTMLAttributes, DetailedHTMLProps, ReactElement } from "react";
import { cn } from "../../lib/cn";

type ButtonProps = DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> & {
  variant?: "default" | "outline";
};

export function Button(props: ButtonProps): ReactElement {
  const { className, variant = "default", ...rest } = props;

  const base =
    "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-slate-950";
  const variants: Record<ButtonProps["variant"], string> = {
    default: "bg-slate-50 text-slate-950 hover:bg-slate-200",
    outline: "border border-slate-700 bg-slate-900 text-slate-50 hover:bg-slate-800"
  };

  return <button className={cn(base, variants[variant], className)} {...rest} />;
}

