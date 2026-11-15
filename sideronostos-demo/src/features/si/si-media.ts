const defaultSiMediaBaseUrl = "https://github.com/qiongwenz748-odie/Sideronostos/releases/download/si-media-v1";

export function siVideoUrl(name: string) {
  const baseUrl = process.env.NEXT_PUBLIC_SI_MEDIA_BASE_URL || defaultSiMediaBaseUrl;
  return `${baseUrl.replace(/\/$/, "")}/${name}.mp4`;
}
