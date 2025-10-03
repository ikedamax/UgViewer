import * as React from "react";

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ScrollArea({ className = "", children, ...props }: ScrollAreaProps) {
  return (
    <div className={`relative overflow-hidden ${className}`} {...props}>
      <div className="h-full w-full overflow-auto pr-2">{children}</div>
    </div>
  );
}
