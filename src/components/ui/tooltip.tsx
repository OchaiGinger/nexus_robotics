"use client";

import * as React from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

const TooltipRoot = Tooltip.Root;
const TooltipTrigger = Tooltip.Trigger;
const TooltipPositioner = Tooltip.Positioner;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof Tooltip.Popup>,
  React.ComponentPropsWithoutRef<typeof Tooltip.Popup>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <Tooltip.Portal>
    <TooltipPositioner sideOffset={sideOffset} side="top" align="center">
      <Tooltip.Popup
        ref={ref}
        className={cn(
          "z-50 overflow-hidden rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-md",
          className,
        )}
        {...props}
      />
    </TooltipPositioner>
  </Tooltip.Portal>
));
TooltipContent.displayName = "TooltipContent";

export { TooltipRoot as Tooltip, TooltipTrigger, TooltipContent };
