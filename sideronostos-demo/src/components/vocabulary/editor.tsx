"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PARTS_OF_SPEECH, type PartOfSpeech, type VocabularyDocument, type VocabularyEntry, type VocabularySense } from "./document";

type Form = { kind: "entry" | "sense" | "example"; entryId?: string; senseId?: string; id?: string; text: string; partOfSpeech: PartOfSpeech };
type Deletion = { entryId: string; senseId?: string; label: string };

export function VocabularyEditor({ value, onChange, disabled = false }: { value: VocabularyDocument; onChange: (value: VocabularyDocument) => void; disabled?: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(value.entries[0]?.id ?? null);
  const [form, setForm] = useState<Form | null>(null);
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const selected = value.entries.find((entry) => entry.id === selectedId) ?? value.entries[0];

  function updateEntry(entryId: string, update: (entry: VocabularyEntry) => VocabularyEntry) {
    onChange({ ...value, entries: value.entries.map((entry) => entry.id === entryId ? update(entry) : entry) });
  }
  function updateSense(entryId: string, senseId: string, update: (sense: VocabularySense) => VocabularySense) {
    updateEntry(entryId, (entry) => ({ ...entry, senses: entry.senses.map((sense) => sense.id === senseId ? update(sense) : sense) }));
  }
  function submit() {
    if (!form || !form.text.trim()) return;
    const id = form.id ?? crypto.randomUUID();
    const text = form.text.trim();
    if (form.kind === "entry") {
      if (form.id) updateEntry(form.id, (entry) => ({ ...entry, word: text }));
      else onChange({ ...value, entries: [...value.entries, { id, word: text, senses: [] }] });
      setSelectedId(id);
    } else if (form.kind === "sense" && form.entryId) {
      updateEntry(form.entryId, (entry) => ({ ...entry, senses: form.id
        ? entry.senses.map((sense) => sense.id === id ? { ...sense, definition: text, partOfSpeech: form.partOfSpeech } : sense)
        : [...entry.senses, { id, definition: text, partOfSpeech: form.partOfSpeech, examples: [] }] }));
    } else if (form.kind === "example" && form.entryId && form.senseId) {
      updateSense(form.entryId, form.senseId, (sense) => ({ ...sense, examples: form.id
        ? sense.examples.map((example) => example.id === id ? { ...example, text } : example)
        : [...sense.examples, { id, text }] }));
    }
    setForm(null);
  }
  function confirmDelete() {
    if (!deletion) return;
    if (deletion.senseId) updateEntry(deletion.entryId, (entry) => ({ ...entry, senses: entry.senses.filter((sense) => sense.id !== deletion.senseId) }));
    else {
      const entries = value.entries.filter((entry) => entry.id !== deletion.entryId);
      onChange({ ...value, entries });
      if (selected?.id === deletion.entryId) setSelectedId(entries[0]?.id ?? null);
    }
    setDeletion(null);
  }
  const fieldLabel = form?.kind === "entry" ? "词汇" : form?.kind === "sense" ? "释义" : "例句正文";
  const formTitle = `${form?.id ? "修改" : "添加"}${form?.kind === "entry" ? "词汇" : form?.kind === "sense" ? "释义与词性" : "例句"}`;

  return <div className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,9fr)]" data-testid="vocabulary-editor">
    <aside className="flex min-h-0 min-w-0 flex-col border-r border-white/10" aria-label="词汇列表">
      <div className="flex shrink-0 justify-center border-b border-white/10 py-2">
        <Button variant="ghost" size="icon-sm" aria-label="添加词汇" title="添加词汇" disabled={disabled} onClick={() => setForm({ kind: "entry", text: "", partOfSpeech: "名词" })}><Plus /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1">
        {value.entries.length === 0 && <p className="px-1 py-2 text-center text-xs text-muted-foreground">暂无词汇</p>}
        {value.entries.map((entry) => <button key={entry.id} type="button" disabled={disabled} title={entry.word} aria-pressed={selected?.id === entry.id}
          className={cn("block w-full truncate px-2 py-1 text-left text-[12px] leading-5 tracking-wider hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-ring", selected?.id === entry.id && "bg-primary/15 text-primary")}
          onClick={() => setSelectedId(entry.id)}>{entry.word}</button>)}
      </div>
    </aside>
    <section className="min-h-0 min-w-0 overflow-y-auto p-4 sm:p-6" aria-label="词汇详情">
      {!selected ? <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><p>添加第一个词汇，开始整理释义和例句</p><Button disabled={disabled} onClick={() => setForm({ kind: "entry", text: "", partOfSpeech: "名词" })}><Plus />添加第一个词汇</Button></div> : <>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <h2 className="min-w-0 break-all text-xl font-semibold">{selected.word}</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => setForm({ kind: "entry", id: selected.id, text: selected.word, partOfSpeech: "名词" })}><Pencil />修改词汇</Button>
            <Button variant="ghost" size="sm" className="text-destructive" disabled={disabled} onClick={() => setDeletion({ entryId: selected.id, label: selected.word })}><Trash2 />删除词汇</Button>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">释义与词性</h3><Button size="sm" disabled={disabled} onClick={() => setForm({ kind: "sense", entryId: selected.id, text: "", partOfSpeech: "名词" })}><Plus />添加释义</Button></div>
        {selected.senses.length === 0 && <p className="py-6 text-sm text-muted-foreground">暂无释义，请添加释义与词性</p>}
        <div className="space-y-4">{selected.senses.map((sense) => <article key={sense.id} className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><span className="inline-block rounded bg-primary/10 px-2 py-1 text-xs text-primary">{sense.partOfSpeech}</span><h4 className="mt-2 whitespace-pre-wrap break-words text-sm font-medium">{sense.definition}</h4></div>
            <div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon-sm" aria-label={`修改释义：${sense.definition}`} disabled={disabled} onClick={() => setForm({ kind: "sense", entryId: selected.id, id: sense.id, text: sense.definition, partOfSpeech: sense.partOfSpeech })}><Pencil /></Button><Button variant="ghost" size="icon-sm" aria-label={`删除释义：${sense.definition}`} disabled={disabled} onClick={() => setDeletion({ entryId: selected.id, senseId: sense.id, label: sense.definition })}><Trash2 /></Button></div>
          </div>
          <div className="mt-4 border-t border-white/10 pt-3"><div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">例句</span><Button variant="ghost" size="sm" disabled={disabled} onClick={() => setForm({ kind: "example", entryId: selected.id, senseId: sense.id, text: "", partOfSpeech: "名词" })}><Plus />添加例句</Button></div>
            {sense.examples.length === 0 && <p className="py-3 text-sm text-muted-foreground">暂无例句</p>}
            <ol className="space-y-2">{sense.examples.map((example, index) => <li key={example.id} className="flex items-center gap-2 rounded-md bg-white/[0.025] p-2 text-sm"><span className="text-xs text-muted-foreground">{index + 1}.</span><p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{example.text}</p><div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon-sm" aria-label={`修改例句：${example.text}`} disabled={disabled} onClick={() => setForm({ kind: "example", entryId: selected.id, senseId: sense.id, id: example.id, text: example.text, partOfSpeech: "名词" })}><Pencil /></Button><Button variant="ghost" size="icon-sm" aria-label={`删除例句：${example.text}`} disabled={disabled} onClick={() => updateSense(selected.id, sense.id, (current) => ({ ...current, examples: current.examples.filter((item) => item.id !== example.id) }))}><Trash2 /></Button></div></li>)}</ol>
          </div>
        </article>)}</div>
      </>}
    </section>
    <Dialog open={Boolean(form)} onOpenChange={(open) => !open && setForm(null)}><DialogContent><DialogHeader><DialogTitle>{formTitle}</DialogTitle><DialogDescription>确认后自动保存到词汇库</DialogDescription></DialogHeader>
      <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="grid gap-4">
        <div className="grid gap-2"><Label htmlFor="vocabulary-text">{fieldLabel}</Label>{form?.kind === "entry" ? <Input autoFocus id="vocabulary-text" value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} /> : <textarea autoFocus id="vocabulary-text" rows={4} className="w-full rounded-md border bg-transparent p-3 text-sm focus-visible:outline-ring" value={form?.text ?? ""} onChange={(event) => form && setForm({ ...form, text: event.target.value })} />}</div>
        {form?.kind === "sense" && <div className="grid gap-2"><Label htmlFor="vocabulary-pos">词性</Label><select id="vocabulary-pos" className="h-9 rounded-md border bg-background px-3 text-sm" value={form.partOfSpeech} onChange={(event) => setForm({ ...form, partOfSpeech: event.target.value as PartOfSpeech })}>{PARTS_OF_SPEECH.map((pos) => <option key={pos}>{pos}</option>)}</select></div>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setForm(null)}>取消</Button><Button type="submit" disabled={disabled || !form?.text.trim()}>确认</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    <Dialog open={Boolean(deletion)} onOpenChange={(open) => !open && setDeletion(null)}><DialogContent><DialogHeader><DialogTitle>{deletion?.senseId ? "删除释义" : "删除词汇"}</DialogTitle><DialogDescription>确定删除“{deletion?.label}”？{deletion?.senseId ? "该释义下的所有例句会一并删除。" : "该词汇下的所有释义和例句会一并删除。"}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeletion(null)}>取消</Button><Button variant="destructive" disabled={disabled} onClick={confirmDelete}>确认删除</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
