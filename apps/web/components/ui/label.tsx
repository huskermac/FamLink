import type { DetailedHTMLProps, LabelHTMLAttributes, ReactElement } from "react";
import { cn } from "../../lib/cn";

export function Label(
  props: DetailedHTMLProps<LabelHTMLAttributes<HTMLLabelElement>, HTMLLabelElement>
): ReactElement {
  const { className, ...rest } = props;
  return (
    <label
      className={cn("text-sm font-medium leading-none text-slate-200 peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
      {...rest}
    />
  );
}
