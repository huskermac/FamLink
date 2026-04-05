import type { HTMLAttributes, ReactElement } from "react";
import { cn } from "../../lib/cn";

export function Card(props: HTMLAttributes<HTMLDivElement>): ReactElement {
  const { className, ...rest } = props;
  return (
    <div
      className={cn("rounded-lg border border-slate-800 bg-slate-900/60 p-6 shadow-sm", className)}
      {...rest}
    />
  );
}

export function CardTitle(props: HTMLAttributes<HTMLHeadingElement>): ReactElement {
  const { className, ...rest } = props;
  return <h2 className={cn("text-lg font-semibold text-slate-50", className)} {...rest} />;
}
