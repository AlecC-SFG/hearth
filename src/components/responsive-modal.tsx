import type { ReactNode } from "react"
import { Drawer } from "vaul"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useIsDesktop } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  /** false = must be answered (no close button, no swipe-down) */
  dismissible?: boolean
}

/** Centered dialog on desktop, Vaul bottom sheet on phones. */
export function ResponsiveModal({ open, onOpenChange, title, description, children, footer, className, dismissible = true }: Props) {
  const desktop = useIsDesktop()

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent showCloseButton={dismissible} className={cn("flex max-h-[88dvh] flex-col gap-0 p-0 sm:max-w-lg", className)}>
          <DialogHeader className="border-b px-5 pt-5 pb-4">
            <DialogTitle className="font-display text-xl">{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t px-5 py-3">{footer}</div>}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false} dismissible={dismissible}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Drawer.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-3xl bg-popover text-popover-foreground outline-none",
            className,
          )}
        >
          <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/25" />
          <div className="px-5 pt-3 pb-2">
            <Drawer.Title className="font-display text-xl font-semibold">{title}</Drawer.Title>
            {description ? (
              <Drawer.Description className="text-sm text-muted-foreground">{description}</Drawer.Description>
            ) : (
              <Drawer.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</Drawer.Description>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4" data-vaul-no-drag>
            {children}
          </div>
          {footer && <div className="safe-bottom flex gap-2 border-t px-5 py-3 [&>*]:flex-1">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
