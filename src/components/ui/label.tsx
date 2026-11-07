"use client"

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 label text-neutral-11 select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:text-neutral-10 peer-disabled:cursor-not-allowed peer-disabled:text-neutral-10",
        className
      )}
      {...props}
    />
  )
}

export { Label }
