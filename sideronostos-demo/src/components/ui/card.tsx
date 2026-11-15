"use client"

import * as React from "react"
import { cn } from "cn"
import { SurfaceProvider, useSurfaceAppearance, type SurfaceTone, type SurfaceMaterial } from "./surface"

const interactiveCardClassName = "cursor-pointer transition-[border-color,background-color,box-shadow] hover:border-ring/60! hover:bg-accent! has-[:focus-visible]:border-ring! has-[:focus-visible]:bg-accent!"

function Card({
  className,
  size = "default",
  interactive = false,
  surface,
  material = "solid",
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm"
  interactive?: boolean
  surface?: SurfaceTone
  material?: SurfaceMaterial
}) {
  const inherited = useSurfaceAppearance()
  const tone = material === "glass" ? "dark" : surface ?? inherited.tone
  return (
    <SurfaceProvider tone={tone} material={material}><div
      data-slot="card"
      data-surface={tone}
      data-material={material}
      data-material-nested={material === "glass" && inherited.material === "glass" || undefined}
      data-size={size}
      data-interactive={interactive || undefined}
      className={cn(
        "bg-card group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-2xl border border-border py-(--card-spacing) text-sm text-card-foreground [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-2xl *:[img:last-child]:rounded-b-2xl",
        interactive && interactiveCardClassName,
        className
      )}
      {...props}
    /></SurfaceProvider>
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium tracking-tight group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "brand-gradient-subtle flex items-center rounded-b-lg border-t p-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  interactiveCardClassName,
}
