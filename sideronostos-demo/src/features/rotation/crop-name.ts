export function englishCropName(name: string) {
  const [english, localized] = name.split(/\s*\/\s*/, 2);
  if (!localized) return name;
  const note = localized.match(/[（(].*$/)?.[0]
    ?.replace(/^（/, "(")
    .replace(/）$/, ")");
  return `${english.trim()}${note ? ` ${note}` : ""}`;
}
