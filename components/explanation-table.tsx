import type { CSSProperties } from "react";
import { EXPLANATION_HEADERS, explanationColumns, explanationRows, type ExplanationOptions } from "@/lib/docx";
import type { Project } from "@/lib/types";

export default function ExplanationTable({ project, onSelect, options }: { project: Project; onSelect?: (stepId: string, routeIndex?: number) => void; options?: ExplanationOptions }) {
  const rows = explanationRows(project, options);
  const columns = explanationColumns(options);
  return <div className="word-preview explanation-text"><table className={`explanation-table${columns.length ? " with-metadata-columns" : ""}`} style={columns.length ? { "--metadata-column-count": columns.length } as CSSProperties : undefined} data-metadata-column-count={columns.length} aria-label="İş axınının izah cədvəli">
    <thead><tr>{[...EXPLANATION_HEADERS, ...columns.map((field) => field.label)].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map(row => <tr key={row.number} className={row.routeIndex !== undefined ? "branch-row" : ""}>
      <td>{onSelect ? <button type="button" className="row-number-button" aria-label={`${row.number} nömrəli izahı aç`} onClick={() => onSelect(row.stepId, row.routeIndex)}>{row.number}</button> : row.number}</td><td>{row.actor}</td><td><strong>{row.title}</strong>{row.description && <p>{row.description}</p>}{row.notes.map((note, index) => <p key={index}>{note}</p>)}</td>{columns.map((field) => <td key={field.key} className="metadata-cell">{row.metadata[field.key]}</td>)}
    </tr>) : <tr><td colSpan={3 + columns.length}>İlk addımı əlavə etdikdə izah cədvəli burada yaranacaq.</td></tr>}</tbody>
  </table></div>;
}
