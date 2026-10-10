import { explanationRows } from "@/lib/docx";
import type { Project } from "@/lib/types";

export default function ExplanationTable({ project, onSelect }: { project: Project; onSelect?: (stepId: string, routeIndex?: number) => void }) {
  const rows = explanationRows(project);
  return <div className="word-preview explanation-text"><table className="explanation-table" aria-label="İş axınının izah cədvəli">
    <thead><tr><th>Addımın sıra N-si</th><th>İcraçı</th><th>Addımların təsviri</th></tr></thead>
    <tbody>{rows.length ? rows.map(row => <tr key={row.number} className={row.routeIndex !== undefined ? "branch-row" : ""}>
      <td>{onSelect ? <button type="button" className="row-number-button" aria-label={`${row.number} nömrəli izahı aç`} onClick={() => onSelect(row.stepId, row.routeIndex)}>{row.number}</button> : row.number}</td><td>{row.actor}</td><td><strong>{row.title}</strong>{row.description && <p>{row.description}</p>}{row.notes.map((note, index) => <p key={index}>{note}</p>)}</td>
    </tr>) : <tr><td colSpan={3}>İlk addımı əlavə etdikdə izah cədvəli burada yaranacaq.</td></tr>}</tbody>
  </table></div>;
}
