import { redirect } from "next/navigation";

/** Preserve old saved/shared map URLs after verified MapLibre science migration. */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
    else if (value !== undefined) query.append(key, value);
  }
  redirect(`/fields${query.size ? `?${query}` : ""}`);
}
