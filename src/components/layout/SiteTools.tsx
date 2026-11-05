import { PrintLink } from "./PrintLink";
import { Portlet, type MenuItem } from "./Portlet";
import styles from "./layout.module.css";

const GENERAL: MenuItem[] = [
  { href: "/random", label: "Random discovery" },
  { href: "/discover", label: "Discover feed" },
  { href: "/topics", label: "All topics" },
  { href: "/discover#ranking", label: "How ranking works" },
  { href: "/search", label: "Search articles" },
];

const PROJECTS: MenuItem[] = [
  { href: "https://www.wikidata.org/", label: "Wikidata", external: true },
  { href: "https://commons.wikimedia.org/", label: "Wikimedia Commons", external: true },
];

/**
 * The tools column of index pages: general destinations, print, and the
 * projects Wikihole reads from. Pages put their own sections first.
 */
export function SiteTools({ children, general = GENERAL }: { children?: React.ReactNode; general?: MenuItem[] }) {
  return (
    <div className={styles.tools}>
      {children}
      <Portlet id="tools-general" heading="General" items={general} />
      <Portlet id="tools-print" heading="Print/export">
        <ul className={styles.portletList}>
          <li>
            <PrintLink />
          </li>
        </ul>
      </Portlet>
      <Portlet id="tools-projects" heading="In other projects" items={PROJECTS} />
    </div>
  );
}
