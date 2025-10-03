import * as React from "react";

type Variant = "default" | "outline" | "info";

const variantClasses: Record<Variant, string> = {
  default: "bg-slate-900 text-white border-transparent",
  outline: "bg-white text-slate-700 border border-slate-200",
  info: "bg-indigo-100 text-indigo-700 border border-indigo-200",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className = "", variant = "default", ...props },
  ref
) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border";
  return <span ref={ref} className={`${base} ${variantClasses[variant]} ${className}`.trim()} {...props} />;
});
