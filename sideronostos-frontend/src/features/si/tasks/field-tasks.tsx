"use client";

import { useState } from "react";
import Link from "next/link";
import * as fields from "@/lib/api/field-shift";
import { Input, linkStyle, LoadingState, NoFields, tr, useLoad, type TaskProps } from "./shared";

export function FieldList(props: TaskProps) {
  const { language } = props;
  const records = useLoad(fields.listFields);
  const [query, setQuery] = useState("");
  const matches = records.data?.items.filter((item) => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  return <div className="space-y-3"><LoadingState state={records} language={language} />
    {records.data && !records.loading && (records.data.items.length ? <>
      {records.data.items.length > 5 && <Input label={tr(language, "Find a field", "查找地块")} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />}
      {!matches.length && <p>{tr(language, "No fields match that name.", "没有找到该名称的地块。")}</p>}
      <ul className="divide-y divide-border">{matches.map((field) => <li key={field.id} className="py-3 first:pt-0"><div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="break-words font-semibold">{field.name}</h4><span className="text-xs text-muted-foreground">{field.area_ha} ha · {field.latitude.toFixed(3)}, {field.longitude.toFixed(3)}</span></div><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1"><Link className={linkStyle} href={`/si/fields?field=${encodeURIComponent(field.id)}&step=field`}>{tr(language, `Open ${field.name}`, `打开${field.name}`)}</Link><Link className={linkStyle} href={`/si/fields?field=${encodeURIComponent(field.id)}&step=field`}>{tr(language, "Edit details", "修改资料")}</Link><Link className={linkStyle} href={`/si/fields?field=${encodeURIComponent(field.id)}&step=environment`}>{tr(language, "Check conditions", "查看环境")}</Link><Link className={linkStyle} href={`/si/fields?field=${encodeURIComponent(field.id)}&step=field`}>{tr(language, "Planting history", "种植历史")}</Link></div></li>)}</ul>
    </> : <NoFields language={language} />)}
  </div>;
}
