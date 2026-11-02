/** Wikimedia media hosts we allow images from (mirrored in the CSP). */
export const MEDIA_HOSTS = ["upload.wikimedia.org", "thumb.wikimedia.org"] as const;

/**
 * True for raster thumbnails rendered from SVG originals. These are almost
 * always line diagrams drawn black-on-transparent, which vanish on a dark
 * background, so we invert them (as Wikipedia's own dark mode does).
 */
export function isLineArt(src: string): boolean {
  return /\.svg(?:\/|\.png|$|\?)/i.test(src);
}

/** Normalises a (possibly protocol-relative) media URL, or rejects it. */
export function normalizeMediaUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const candidate = raw.trim().startsWith("//") ? `https:${raw.trim()}` : raw.trim();
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") return null;
    if (!(MEDIA_HOSTS as readonly string[]).includes(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
