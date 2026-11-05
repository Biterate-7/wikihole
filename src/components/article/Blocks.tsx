import { isLineArt } from "@/lib/content/media";
import type { Block, Inline, WikiImage } from "@/lib/content/types";
import { InlineContent, MathView } from "./Inline";
import styles from "./article.module.css";

function Img({ img, sizes }: { img: WikiImage; sizes?: string }) {
  return (
    // Wikimedia serves pre-sized thumbnails with their own srcset; Next's optimiser would only add a hop.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={img.src}
      srcSet={img.srcSet}
      sizes={sizes}
      width={img.width}
      height={img.height}
      alt={img.alt}
      loading="lazy"
      decoding="async"
      className={`${styles.img} ${isLineArt(img.src) ? styles.lineArt : ""}`}
    />
  );
}

function Figure({ img, caption }: { img: WikiImage; caption: Inline[] }) {
  const portrait = img.height > img.width * 1.15;
  // Match the displayed width, so a lazy image takes the same space before and after it loads.
  const displayed = Math.min(img.width, portrait ? 200 : 260);
  return (
    <figure className={`${styles.figure} ${portrait ? styles.portrait : ""}`}>
      <div className={styles.figureFrame}>
        <Img img={img} sizes={portrait ? `${displayed}px` : `(max-width: 719px) 100vw, ${displayed}px`} />
      </div>
      {caption.length ? (
        <figcaption className={styles.caption}>
          <InlineContent nodes={caption} />
        </figcaption>
      ) : null}
    </figure>
  );
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((block, i) => renderBlock(block, i))}</>;
}

function renderBlock(block: Block, key: number): React.ReactNode {
  switch (block.k) {
    case "p":
      return (
        <p key={key} className={styles.p}>
          <InlineContent nodes={block.c} />
        </p>
      );
    case "h": {
      const Tag = `h${block.level}` as "h3" | "h4" | "h5";
      return (
        <Tag key={key} id={block.id} className={styles[`h${block.level}`]}>
          {block.text}
        </Tag>
      );
    }
    case "note":
      return (
        <p key={key} className={styles.note} data-no-terms>
          <InlineContent nodes={block.c} />
        </p>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag key={key} className={styles.list}>
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineContent nodes={item.c} />
              {item.sub.length ? <Blocks blocks={item.sub} /> : null}
            </li>
          ))}
        </Tag>
      );
    }
    case "dl":
      return (
        <dl key={key} className={styles.dl}>
          {block.items.map((item, i) => (
            <div key={i} className={item.term ? styles.dlItem : styles.indent}>
              {item.term ? (
                <dt>
                  <InlineContent nodes={item.term} />
                </dt>
              ) : null}
              {item.defs.map((d, j) => (
                <dd key={j}>
                  <InlineContent nodes={d} />
                </dd>
              ))}
            </div>
          ))}
        </dl>
      );
    case "math":
      return (
        <div key={key} className={styles.equation}>
          <MathView html={block.html} tex={block.tex} display />
        </div>
      );
    case "figure":
      return <Figure key={key} img={block.img} caption={block.caption} />;
    case "gallery":
      return (
        <div key={key} className={styles.gallery}>
          {block.items.map((item, i) => (
            <figure key={i} className={styles.galleryItem}>
              <div className={styles.figureFrame}>
                <Img img={item.img} sizes="(max-width: 720px) 50vw, 220px" />
              </div>
              {item.caption.length ? (
                <figcaption className={styles.caption}>
                  <InlineContent nodes={item.caption} />
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      );
    case "table":
      return (
        <div key={key} className={styles.tableWrap}>
          <div className={styles.tableScroll} role="region" aria-label={block.caption ? "Table" : "Data table"} tabIndex={0}>
            <table className={styles.table}>
              {block.caption ? (
                <caption>
                  <InlineContent nodes={block.caption} />
                </caption>
              ) : null}
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => {
                      const Cell = cell.header ? "th" : "td";
                      return (
                        <Cell key={c} colSpan={cell.colSpan} rowSpan={cell.rowSpan}>
                          <InlineContent nodes={cell.c} />
                        </Cell>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.truncated ? <p className="label">Table truncated. See the full table on Wikipedia.</p> : null}
        </div>
      );
    case "quote":
      return (
        <blockquote key={key} className={styles.quote}>
          <Blocks blocks={block.c} />
        </blockquote>
      );
    case "code":
      return (
        <pre key={key} className={styles.pre}>
          <code>{block.text}</code>
        </pre>
      );
    case "refs":
      return (
        <ol key={key} className={styles.refs}>
          {block.items.map((ref) => (
            <li key={ref.id} id={ref.id}>
              <span className={styles.refLabel}>{ref.label}</span>
              <span>
                <InlineContent nodes={ref.c} />
              </span>
            </li>
          ))}
        </ol>
      );
  }
}
