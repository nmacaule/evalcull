import * as React from "react"

import { cn } from "@/lib/utils"

// PRD §2.11 Borders: a control is identified by its neutral-9 border (O10); the
// ring comes from the base :focus-visible rule, placeholders and selection from base
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 rounded-control border border-neutral-9 bg-neutral-1 px-2 py-1 text-chrome text-neutral-12 transition-state disabled:cursor-not-allowed disabled:text-neutral-10",
        className
      )}
      {...props}
    />
  )
}

export { Input }
