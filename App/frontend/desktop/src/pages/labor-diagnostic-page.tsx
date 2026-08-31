/** Labor-employment diagnostic PoC page. */

import { useCallback, useState } from "react";
import { PanelRight } from "lucide-react";
import { WorkspacePreviewPane } from "../components/workspace-preview-pane.js";
import { useTranslation } from "../i18n/use-translation.js";
import { AppFrame } from "./app-frame.js";
import {
  buildLegalDiagListing,
  buildLegalDiagPreview
} from "./labor-diagnostic-demo-data.js";
import { type LegalDiagPhase, readLegalDiagnosisPrompt } from "./labor-diagnostic-model.js";
import { LaborDiagnosticWorkflow } from "./labor-diagnostic-workflow.js";

export function LaborDiagnosticPage() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<LegalDiagPhase>({ kind: "setup" });
  const [composerDraft, setComposerDraft] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const prompt = readLegalDiagnosisPrompt();
  const filesReady = phase.kind === "task" || phase.kind === "review";

  const loadDirectory = useCallback(async (_sessionKey: string, relativePath: string) => {
    return buildLegalDiagListing(relativePath, filesReady);
  }, [filesReady]);

  const loadPreview = useCallback(async (relativePath: string) => {
    return buildLegalDiagPreview(relativePath);
  }, []);

  const title = phase.kind === "task"
    ? t("legalDiagnosis.title.execution")
    : t("legalDiagnosis.title.setup");

  return (
    <AppFrame title={t("nav.legalDiagnosis")} reserveTopBar={false}>
      <section className="litrev-split">
        <button
          type="button"
          className={`litrev-workspace-toggle${workspaceOpen ? " litrev-workspace-toggle--active" : ""}`}
          aria-label={t("common.preview")}
          aria-pressed={workspaceOpen}
          onClick={() => setWorkspaceOpen((open) => !open)}
        >
          <PanelRight size={15} />
        </button>
        <div className={`litrev-chat-pane${workspaceOpen ? " litrev-chat-pane--with-side" : ""}`}>
          <header className="litrev-chat-pane__topbar">
            <h1 className="agent-conversation-title">{title}</h1>
          </header>
          <LaborDiagnosticWorkflow
            prompt={prompt}
            phase={phase}
            onPhaseChange={setPhase}
            composerDraft={composerDraft}
            onComposerDraftChange={setComposerDraft}
            onComposerSubmit={() => undefined}
          />
        </div>
        {workspaceOpen ? (
          <WorkspacePreviewPane
            sessionKey={`legal-diagnosis:${filesReady ? "ready" : "empty"}`}
            rootLabel={t("nav.legalDiagnosis")}
            loadDirectory={loadDirectory}
            loadPreview={loadPreview}
            refreshKey={filesReady ? "ready" : "empty"}
            emptyLabel={t("workspacePreview.noFiles")}
            emptyDetail={t("legalDiagnosis.preview.taskEmpty")}
          />
        ) : null}
      </section>
    </AppFrame>
  );
}
