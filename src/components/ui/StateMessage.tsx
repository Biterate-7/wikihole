import styles from "./ui.module.css";

interface Props {
  kind: "error" | "empty";
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}

/** Restrained error / empty state block. */
export function StateMessage({ kind, title, children, action }: Props) {
  return (
    <div className={styles.state} role={kind === "error" ? "alert" : "status"}>
      <p className="label">{kind === "error" ? "Error" : "Nothing here"}</p>
      <p className={styles.stateTitle}>{title}</p>
      {children ? <div className={styles.stateBody}>{children}</div> : null}
      {action ? <div className={styles.stateAction}>{action}</div> : null}
    </div>
  );
}
