"use client";

import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Surface } from "./surface";
import "./patterns.css";

/** Reference-page metric strip: a large value, quiet metadata, shared dividers. */
export function MetricPanel({ title, eyebrow, metrics, action, className, ...props }: React.ComponentProps<typeof Surface> & {
  title: string;
  eyebrow?: string;
  metrics: { label: string; value: string; detail: string }[];
  action?: React.ReactNode;
}) {
  return <Surface {...props} className={cn("metric-panel", className)}>
    <header>{eyebrow && <p className="pattern-eyebrow">{eyebrow}</p>}<div className="metric-panel-heading"><h3>{title}</h3>{action}</div></header>
    <dl className="metric-panel-values">{metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd><span>{metric.detail}</span></div>)}</dl>
  </Surface>;
}

/** A horizontal workflow entry, following the landing page's icon / copy / action rhythm. */
export function ActionTile({ icon, title, description, className, ...props }: React.ComponentProps<"button"> & {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return <button type="button" {...props} className={cn("action-tile", className)}>
    <span className="action-tile-icon" aria-hidden="true">{icon}</span>
    <span className="action-tile-copy"><strong>{title}</strong><span>{description}</span></span>
    <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
  </button>;
}

/** One blurred surface around an entire action group; children never add blur. */
export function FloatingToolbar({ className, children, ...props }: React.ComponentProps<typeof Surface>) {
  return <Surface material="glass" role="group" {...props} className={cn("floating-toolbar", className)}>{children}</Surface>;
}
