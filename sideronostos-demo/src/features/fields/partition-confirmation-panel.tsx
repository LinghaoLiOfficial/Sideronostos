"use client"

import { CheckCircle2, Pentagon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n/provider"
import type { FarmFeature, FieldFeature } from "@/types/workspace"

export function PartitionConfirmationPanel({ farm, fields, onConfirm }: {
  farm: FarmFeature | null
  fields: FieldFeature[]
  onConfirm: () => void
}) {
  const { t } = useI18n()
  if (!farm) return null
  const children = fields.filter(field => field.properties.farmId === farm.properties.id)
  if (!children.length) return null
  const confirmed = children.every(field => field.properties.status === "confirmed")
  return <section className="border-b p-4" aria-label={t("Boundary confirmation")}>
    <div className="flex items-center gap-2 text-sm font-semibold">
      {confirmed ? <CheckCircle2 className="size-4 text-emerald-700" /> : <Pentagon className="size-4 text-amber-600" />}
      <h2>{t(confirmed ? "Boundaries confirmed" : "Confirm field boundaries")}</h2>
    </div>
    <p className="mt-2 text-xs font-medium">{farm.properties.name} · {children.length} {t("fields")}</p>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">{t(confirmed
      ? "The field boundaries are confirmed and locked."
      : "Orange fields are candidates. Review and adjust their shared boundaries on the map, then confirm all fields in this farm.")}</p>
    {!confirmed && <Button type="button" className="mt-3 w-full" onClick={onConfirm}>
      <CheckCircle2 />{t("Confirm all {count} fields", { count: children.length })}
    </Button>}
  </section>
}
