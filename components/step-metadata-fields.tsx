import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { STEP_METADATA_FIELDS, type Step } from "@/lib/types";

export default function StepMetadataFields({ step, labelPrefix, onChange }: {
  step: Step;
  labelPrefix: string;
  onChange: (patch: Partial<Step>) => void;
}) {
  const [expanded, setExpanded] = useState(() => STEP_METADATA_FIELDS.some(field => Boolean(step[field.key]?.trim())));
  return <details className="step-metadata" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><span>Əlavə məlumatlar</span><small>İstəyə bağlı</small><ChevronDown size={14}/></summary>
    <div className="step-metadata-fields">{STEP_METADATA_FIELDS.map(field => <label className="field-label" key={field.key}>
      {field.label}<input aria-label={`${labelPrefix} — ${field.label}`} value={step[field.key] ?? ""} maxLength={field.maxLength}
        placeholder={field.placeholder} onChange={event => onChange({ [field.key]: event.target.value || undefined })}/>
    </label>)}</div>
  </details>;
}
