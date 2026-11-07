import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// PRD §2.11: one primary action per screen, so primary is always explicit and a
// Button with no variant is secondary; the ring comes from the base :focus-visible rule
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap transition-state disabled:pointer-events-none disabled:text-neutral-10 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Disabled, the primary keeps a neutral-3 fill, since neutral-10 on the accent is no §2.11 pairing
        primary: "bg-primary-fill text-on-primary hover:bg-primary-fill-hover disabled:bg-neutral-3",
        secondary:
          "border border-neutral-9 bg-neutral-3 text-neutral-12 hover:bg-neutral-4 active:bg-neutral-5",
        ghost: "text-neutral-12 hover:bg-neutral-4 active:bg-neutral-5",
      },
      size: {
        default: "px-3 py-2 text-chrome",
        sm: "px-2 py-1 text-chrome",
        icon: "p-1",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "secondary",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
