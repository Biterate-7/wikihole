import Link from "next/link";
import { PinnableHeader, ToolsToggle } from "./Chrome";
import { MainMenu } from "./MainMenu";
import { Portlet } from "./Portlet";
import styles from "./layout.module.css";

export interface PageTab {
  label: string;
  href: string;
  selected?: boolean;
  external?: boolean;
  title?: string;
  testId?: string;
}

interface Props {
  /** What the left sidebar holds: the main menu (index pages) or the article's contents. */
  start?: "main-menu" | "toc";
  /** The pinned table of contents, for start="toc". */
  toc?: React.ReactNode;
  /** Shown before the title when the contents are not pinned (the collapsed contents button). */
  titleStart?: React.ReactNode;
  title: React.ReactNode;
  /** The Main Page hides its title, as Wikipedia's does. */
  hideTitle?: boolean;
  titleLang?: string;
  titleDir?: "ltr" | "rtl";
  /** Right end of the title bar (e.g. the edition button). */
  titleEnd?: React.ReactNode;
  tabs?: { left: PageTab[]; right?: PageTab[] };
  /** Extra toolbar actions after the view tabs (e.g. the save star). */
  actions?: React.ReactNode;
  /** The right "Tools" column. */
  tools?: React.ReactNode;
  toolsLabel?: string;
  testId?: string;
  dataLang?: string;
  children: React.ReactNode;
}

function Tabs({ tabs, label }: { tabs: PageTab[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ul className={styles.tabs}>
        {tabs.map((tab) => (
          <li key={tab.label} className={tab.selected ? styles.tabSelected : undefined}>
            {tab.external ? (
              <a href={tab.href} target="_blank" rel="noopener noreferrer" title={tab.title} data-testid={tab.testId}>
                {tab.label}
              </a>
            ) : (
              <Link href={tab.href} aria-current={tab.selected ? "page" : undefined} title={tab.title} prefetch={false} data-testid={tab.testId}>
                {tab.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The page frame shared by every route: left sidebar (main menu or
 * contents), the title bar with its namespace and view tabs, the content,
 * and the right tools column, laid out as Wikipedia's Vector 2022 skin.
 */
export function PageShell({
  start = "main-menu",
  toc,
  titleStart,
  title,
  hideTitle,
  titleLang,
  titleDir,
  titleEnd,
  tabs,
  actions,
  tools,
  toolsLabel = "Tools",
  testId,
  dataLang,
  children,
}: Props) {
  return (
    <div className={styles.inner} data-start={start} data-testid={testId} data-lang={dataLang}>
      <div className={styles.columnStart}>
        <div className={styles.pinnedContainer}>{start === "main-menu" ? <MainMenu place="sidebar" /> : toc}</div>
      </div>
      <div className={styles.content}>
        <div className={styles.body} data-has-tools={tools ? "" : undefined}>
          <header className={`${styles.pageHeader} ${hideTitle ? styles.titleHidden : ""}`}>
            <div className={styles.titlebar}>
              {titleStart}
              <h1 className={hideTitle ? "visually-hidden" : styles.firstHeading} lang={titleLang} dir={titleDir}>
                {title}
              </h1>
              {titleEnd ? <div className={styles.titleEnd}>{titleEnd}</div> : null}
            </div>
            {tabs || actions || tools ? (
              <div className={styles.toolbar}>
                {tabs ? <Tabs tabs={tabs.left} label="Namespaces" /> : <span />}
                <div className={styles.toolbarEnd}>
                  {tabs?.right ? (
                    <div className={tools ? styles.views : undefined}>
                      <Tabs tabs={tabs.right} label="Views" />
                    </div>
                  ) : null}
                  {actions}
                  {tools ? <ToolsToggle controls="page-tools" /> : null}
                </div>
              </div>
            ) : null}
          </header>
          {tools ? (
            <aside id="page-tools" className={styles.columnEnd} aria-label={toolsLabel}>
              <div className={styles.pinnedContainer}>
                <PinnableHeader label={toolsLabel} panel="tools" place="both" />
                {tabs?.right ? (
                  // On narrow screens the view tabs fold into the tools menu, as in Vector.
                  <div className={styles.foldedViews}>
                    <Portlet
                      id="tools-actions"
                      heading="Actions"
                      items={tabs.right.map((tab) => ({ href: tab.href, label: tab.label, external: tab.external, current: tab.selected }))}
                    />
                  </div>
                ) : null}
                {tools}
              </div>
            </aside>
          ) : null}
          <div className={styles.bodyContent}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/** "From Wikipedia, the free encyclopedia" line under the title. */
export function SiteSub({ children }: { children: React.ReactNode }) {
  return <div className={styles.siteSub}>{children}</div>;
}
