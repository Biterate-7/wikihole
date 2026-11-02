"use client";

import { useCallback, useState } from "react";
import { isLineArt } from "@/lib/content/media";
import type { Thumbnail } from "@/lib/wikipedia/types";
import styles from "./thumb.module.css";

/**
 * Square-cropped Wikimedia thumbnail with fixed dimensions (no layout shift).
 * If the image fails to load, the frame collapses to an empty tile.
 */
export function ThumbImage({ thumbnail, size, alt = "" }: { thumbnail: Thumbnail; size: number; alt?: string }) {
  const [failed, setFailed] = useState(false);
  // A server-rendered image can fail before hydration attaches onError, so check on attach too.
  const detectEarlyFailure = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  return (
    <span className={styles.frame} style={{ width: size, height: size }}>
      {failed ? null : (
        // Wikimedia already serves sized thumbnails from its CDN; re-optimising them would only add a hop.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={detectEarlyFailure}
          src={thumbnail.src}
          alt={alt}
          width={thumbnail.width}
          height={thumbnail.height}
          loading="lazy"
          decoding="async"
          className={`${styles.img} ${isLineArt(thumbnail.src) ? styles.lineArt : ""}`}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
