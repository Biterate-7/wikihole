import styles from "./ui.module.css";

interface Props {
  kind: "error" | "empty";
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}

/** Error / empty state, as a Wikipedia message box. */
export function StateMessage({ kind, title, children, action }: Props) {
  return (
    <div className={`${styles.state} ${kind === "error" ? styles.stateError : styles.stateNotice}`} role={kind === "error" ? "alert" : "status"}>
      <p className={styles.stateTitle}>{title}</p>
      {children ? <div className={styles.stateBody}>{children}</div> : null}
      {action ? <div className={styles.stateAction}>{action}</div> : null}
    </div>
  );
}
