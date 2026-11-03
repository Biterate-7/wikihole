import Link from "next/link";
import styles from "./layout.module.css";

export interface MenuItem {
  label: React.ReactNode;
  href: string;
  external?: boolean;
  current?: boolean;
  title?: string;
  lang?: string;
}

/** A sidebar menu section ("portlet"): optional heading, then compact links. */
export function Portlet({
  heading,
  items,
  children,
  id,
  headingTag: Heading = "div",
}: {
  heading?: string;
  items?: MenuItem[];
  children?: React.ReactNode;
  id?: string;
  /** Menus label their sections with plain text, as Wikipedia does; content sections use real headings. */
  headingTag?: "div" | "h2" | "h3";
}) {
  const headingId = heading && id ? `${id}-label` : undefined;
  return (
    <div className={styles.portlet} id={id} role={heading && Heading === "div" ? "group" : undefined} aria-labelledby={Heading === "div" ? headingId : undefined}>
      {heading ? (
        <Heading className={styles.portletHeading} id={headingId}>
          {heading}
        </Heading>
      ) : null}
      {items ? (
        <ul className={styles.portletList}>
          {items.map((item, i) => (
            <li key={i}>
              {item.external ? (
                <a href={item.href} target="_blank" rel="noopener noreferrer" title={item.title} lang={item.lang}>
                  {item.label}
                </a>
              ) : (
                <Link href={item.href} aria-current={item.current ? "page" : undefined} title={item.title} lang={item.lang} prefetch={false}>
                  {item.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {children}
    </div>
  );
}
