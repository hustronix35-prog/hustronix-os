import type { ReactNode } from "react";
import styles from "./table.module.css";
import { cx } from "@/lib/utils";

export function DataTable({
  columns,
  rows,
  newLabel,
  onNew,
  onRowClick,
}: {
  columns: Array<{ key: string; label: string; render?: (row: Record<string, string>) => ReactNode }>;
  rows: Array<Record<string, string>>;
  newLabel?: string;
  onNew?: () => void;
  onRowClick?: (row: Record<string, string>) => void;
}) {
  return (
    <div className={cx("panel", styles.wrap)}>
      {newLabel ? (
        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.newBtn}
            onClick={onNew}
            disabled={!onNew}
            title={onNew ? undefined : "Brain catalogs are fixture-backed — create/edit is not live"}
          >
            + {newLabel}
          </button>
        </div>
      ) : null}
      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={`${row[columns[0].key]}-${idx}`}
                className={onRowClick ? styles.clickable : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key}>{col.render ? col.render(row) : row[col.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.pagination}>
        <span>Showing {rows.length} items</span>
        <div className={styles.pages}>
          <button type="button">1</button>
          <button type="button" className={styles.pageActive}>
            2
          </button>
          <button type="button">3</button>
        </div>
      </div>
    </div>
  );
}
