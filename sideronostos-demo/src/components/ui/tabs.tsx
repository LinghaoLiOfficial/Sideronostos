"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Tabs as TabsPrimitive } from "radix-ui"

type TabsVariant = "default" | "line" | "card"
const TabsVariantContext = React.createContext<TabsVariant>("default")

function Tabs({
  className,
  orientation = "horizontal",
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & {
  variant?: "default" | "line" | "card"
}) {
  return (
    <TabsVariantContext.Provider value={variant}><TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      data-variant={variant}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        variant === "card" && "gap-0",
        className
      )}
      {...props}
    /></TabsVariantContext.Provider>
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "glass-surface border border-primary/15",
        line: "gap-1 bg-transparent",
        card: "relative z-10 -mb-px max-w-full flex-wrap gap-1 overflow-visible bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const inheritedVariant = React.useContext(TabsVariantContext)
  const resolvedVariant = variant ?? inheritedVariant
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={resolvedVariant}
      className={cn(tabsListVariants({ variant: resolvedVariant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
      "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      "group-data-[variant=card]/tabs-list:rounded-t-lg group-data-[variant=card]/tabs-list:px-3 group-data-[variant=card]/tabs-list:py-2 group-data-[variant=card]/tabs-list:text-xs group-data-[variant=card]/tabs-list:data-active:border-border group-data-[variant=card]/tabs-list:data-active:border-b-card group-data-[variant=card]/tabs-list:data-active:bg-card group-data-[variant=card]/tabs-list:data-active:text-accent-foreground",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:border-primary/30 data-active:bg-primary/20 data-active:text-accent-foreground dark:data-active:border-primary/30 dark:data-active:bg-primary/20 dark:data-active:text-accent-foreground",
        "after:absolute after:bg-primary after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "flex-1 text-sm outline-none",
        "group-data-[variant=card]/tabs:glass-surface group-data-[variant=card]/tabs:overflow-hidden group-data-[variant=card]/tabs:rounded-lg group-data-[variant=card]/tabs:border group-data-[variant=card]/tabs:border-border",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
