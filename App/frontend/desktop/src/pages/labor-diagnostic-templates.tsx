import { Download, Mic, Upload, X } from "lucide-react";
import { Button } from "../components/button.js";
import { FileTypeIcon } from "../components/file-type-icon.js";
import { useTranslation } from "../i18n/use-translation.js";

const enterpriseTemplate = new URL("../assets/legal/企业信息表.xlsx", import.meta.url).href;
const interviewTemplate = new URL("../assets/legal/用工合规及风险诊断表_V2.xlsx", import.meta.url).href;

export function LegalDiagnosticTemplates(props: {
  onRecord: () => void;
  onUpload: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const templates = [
    { href: enterpriseTemplate, name: "调研前准备清单.xlsx", title: t("legalDiagnosis.templates.enterprise"), description: t("legalDiagnosis.templates.enterpriseHint") },
    { href: interviewTemplate, name: "调研诊断模版.xlsx", title: t("legalDiagnosis.templates.interview"), description: t("legalDiagnosis.templates.interviewHint") }
  ];
  return (
    <section className="litrev-wizard-card legal-template-card" aria-label={t("legalDiagnosis.templates.title")}>
      <header className="litrev-wizard-card__head">
        <strong>{t("legalDiagnosis.templates.title")}</strong>
        <button type="button" className="litrev-wizard-card__close" aria-label={t("legalDiagnosis.workflow.close")} onClick={props.onDismiss}><X size={15} /></button>
      </header>
      <div className="litrev-wizard-card__body legal-template-card__body">
        {templates.map((template, index) => (
          <a
            className="legal-template-row"
            key={template.name}
            href={template.href}
            download={template.name}
            aria-label={`${t("legalDiagnosis.templates.download")} ${template.title}.xlsx`}
            aria-describedby={`legal-template-description-${index}`}
          >
            <span className="legal-template-row__icon" aria-hidden="true">
              <FileTypeIcon name={template.name} surface="card" />
            </span>
            <div className="legal-template-row__copy">
              <strong>{template.title}<span className="legal-template-row__extension">.xlsx</span></strong>
              <p className="legal-template-row__description" id={`legal-template-description-${index}`}>{template.description}</p>
            </div>
            <span className="legal-template-row__action" aria-hidden="true">
              <Download size={16} strokeWidth={1.5} /><span>{t("legalDiagnosis.templates.download")}</span>
            </span>
          </a>
        ))}
      </div>
      <footer className="litrev-wizard-card__foot legal-template-card__foot">
        <Button type="button" variant="primary" size="sm" onClick={props.onRecord}><Mic size={13} />{t("legalDiagnosis.templates.record")}</Button>
        <Button type="button" variant="secondary" size="sm" onClick={props.onUpload}><Upload size={13} />{t("legalDiagnosis.templates.upload")}</Button>
      </footer>
    </section>
  );
}
