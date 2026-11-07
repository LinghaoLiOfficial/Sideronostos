export const PARTS_OF_SPEECH = ["名词", "动词", "形容词", "副词", "代词", "数词", "量词", "介词", "连词", "助词", "冠词", "感叹词", "其他"] as const;
export type PartOfSpeech = typeof PARTS_OF_SPEECH[number];
export type VocabularyExample = { id: string; text: string };
export type VocabularySense = { id: string; definition: string; partOfSpeech: PartOfSpeech; examples: VocabularyExample[] };
export type VocabularyEntry = { id: string; word: string; senses: VocabularySense[] };
export type VocabularyDocument = { version: 1; entries: VocabularyEntry[] };

export function parseVocabularyDocument(content: unknown): VocabularyDocument {
  if (content === null) return { version: 1, entries: [] };
  const ids = new Set<string>();
  const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
  const text = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
  const id = (value: unknown) => {
    if (!text(value) || ids.has(value)) return false;
    ids.add(value);
    return true;
  };
  if (!object(content) || content.version !== 1 || !Array.isArray(content.entries) || !content.entries.every((entry) =>
    object(entry) && id(entry.id) && text(entry.word) && Array.isArray(entry.senses) && entry.senses.every((sense) =>
      object(sense) && id(sense.id) && text(sense.definition) && PARTS_OF_SPEECH.includes(sense.partOfSpeech as PartOfSpeech) &&
      Array.isArray(sense.examples) && sense.examples.every((example) => object(example) && id(example.id) && text(example.text)),
    ),
  )) throw new Error("Invalid vocabulary document");
  return content as VocabularyDocument;
}
