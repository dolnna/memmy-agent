/** Conversation + survey_master-style cards for the labor diagnostic PoC. */

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Check, ChevronRight, Pencil, Plus, Send, X } from "lucide-react";
import { Button } from "../components/button.js";
import { FileTypeIcon } from "../components/file-type-icon.js";
import { useTranslation } from "../i18n/use-translation.js";
import {
  LEGAL_DIAG_SOURCE_ACCEPT,
  LEGAL_DIAGNOSIS_COMMAND,
  LEGAL_DIAG_QUESTIONS,
  formatSourceSize,
  isLegalDiagSourceName,
  type LegalDiagPhase
} from "./labor-diagnostic-model.js";
import {
  LEGAL_DIAG_ASSISTANT_INTRO,
  LEGAL_DIAG_EXECUTION_INTRO,
  LEGAL_DIAG_MESSAGE_ACK,
  LEGAL_DIAG_MISSING_INFO_INTRO,
  LEGAL_DIAG_MISSING_INFO_ITEMS,
  LEGAL_DIAG_RESULT_LINE,
  LEGAL_DIAG_THINKING_STAGES,
  LEGAL_DIAG_TODO_ITEMS
} from "./labor-diagnostic-demo-data.js";

export const LEGAL_DIAG_THINKING_INTERVAL_MS = 420;
export const LEGAL_DIAG_TODO_INTERVAL_MS = 520;

export interface LegalDiagSourceItem {
  id: string;
  label: string;
  totalBytes?: number;
}

export interface LaborDiagnosticWorkflowProps {
  prompt: string;
  phase: LegalDiagPhase;
  onPhaseChange: (phase: LegalDiagPhase) => void;
  composerDraft: string;
  onComposerDraftChange: (value: string) => void;
  onComposerSubmit: (text: string) => void;
}

export function LaborDiagnosticWorkflow(props: LaborDiagnosticWorkflowProps) {
  const { t } = useTranslation();
  const sourceFileInputRef = useRef<HTMLInputElement | null>(null);
  const onPhaseChangeRef = useRef(props.onPhaseChange);
  onPhaseChangeRef.current = props.onPhaseChange;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [supplements, setSupplements] = useState<Record<string, string>>({});
  const [sourceItems, setSourceItems] = useState<LegalDiagSourceItem[]>([]);
  const [unsupportedCount, setUnsupportedCount] = useState(0);
  const [todoProgress, setTodoProgress] = useState(0);
  const [acks, setAcks] = useState<string[]>([]);

  useEffect(() => {
    if (props.phase.kind !== "thinking") return;
    if (props.phase.stage >= LEGAL_DIAG_THINKING_STAGES.length) {
      onPhaseChangeRef.current({ kind: "task" });
      return;
    }
    const timer = window.setTimeout(() => {
      onPhaseChangeRef.current({ kind: "thinking", stage: props.phase.stage + 1 });
    }, LEGAL_DIAG_THINKING_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [props.phase]);

  useEffect(() => {
    if (props.phase.kind !== "task") return;
    if (todoProgress >= LEGAL_DIAG_TODO_ITEMS.length) {
      onPhaseChangeRef.current({ kind: "review" });
      return;
    }
    const timer = window.setTimeout(() => setTodoProgress((value) => value + 1), LEGAL_DIAG_TODO_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [props.phase.kind, todoProgress]);

  function confirmSetup() {
    setAnswers((current) => {
      const next = { ...current };
      for (const [id, value] of Object.entries(supplements)) {
        if (value.trim() && !next[id]?.trim()) next[id] = value.trim();
      }
      return next;
    });
    props.onPhaseChange({ kind: "sources" });
  }

  function confirmSources() {
    props.onPhaseChange({ kind: "thinking", stage: 0 });
  }

  function skipCurrentCard() {
    if (props.phase.kind === "setup") confirmSetup();
    else if (props.phase.kind === "sources") confirmSources();
  }

  function updateAnswer(id: string, value: string) {
    setAnswers((current) => ({ ...current, [id]: value }));
  }

  function handleSourceFilesPicked(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    const accepted = files.filter((file) => isLegalDiagSourceName(file.name));
    setUnsupportedCount(files.length - accepted.length);
    setSourceItems((current) => [
      ...current,
      ...accepted.map((file) => ({
        id: `${file.name}:${file.size}:${file.lastModified}`,
        label: file.name,
        totalBytes: file.size
      }))
    ]);
  }

  function submitComposer() {
    const text = props.composerDraft.trim();
    if (!text) return;
    if (props.phase.kind === "setup" || props.phase.kind === "sources") {
      skipCurrentCard();
    }
    setAcks((current) => [...current, text]);
    props.onComposerSubmit(text);
    props.onComposerDraftChange("");
  }

  return (
    <>
    <div className="litrev-scroll">
    <div className="litrev-conversation" data-testid="legal-diag-workflow">
      <div className="litrev-user-message">
        <div className="agent-chat-bubble agent-chat-bubble--user litrev-user-bubble">
          <span className="litrev-user-command">{LEGAL_DIAGNOSIS_COMMAND}</span>
          {props.prompt ? `  ${props.prompt}` : ""}
        </div>
      </div>
      <p className="litrev-assistant-copy">{LEGAL_DIAG_ASSISTANT_INTRO}</p>
      {acks.map((text) => (
        <div key={text} className="litrev-supplement">
          <div className="litrev-user-message">
            <div className="agent-chat-bubble agent-chat-bubble--user litrev-user-bubble">{text}</div>
          </div>
          <p className="litrev-assistant-copy">{LEGAL_DIAG_MESSAGE_ACK}</p>
        </div>
      ))}

      {props.phase.kind !== "setup" ? renderVariableSummary() : null}
      {props.phase.kind === "thinking" || props.phase.kind === "task" || props.phase.kind === "review"
        ? sourceItems.length
          ? <p className="litrev-assistant-copy">{t("legalDiagnosis.sources.confirmed", { count: sourceItems.length })}</p>
          : <p className="litrev-assistant-copy">{t("legalDiagnosis.sources.skipped")}</p>
        : null}

      {props.phase.kind === "thinking" || props.phase.kind === "task" || props.phase.kind === "review" ? (
        <p className="litrev-assistant-copy">{LEGAL_DIAG_EXECUTION_INTRO}</p>
      ) : null}
      {props.phase.kind === "thinking" ? renderThinking() : null}
      {props.phase.kind === "task" || props.phase.kind === "review" ? renderTodos() : null}
      {props.phase.kind === "review" ? (
        <>
          <p className="litrev-assistant-copy">{LEGAL_DIAG_RESULT_LINE}</p>
          <div className="litrev-assistant-copy litrev-missing-info">
            <p>{LEGAL_DIAG_MISSING_INFO_INTRO}</p>
            <ol>
              {LEGAL_DIAG_MISSING_INFO_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>
        </>
      ) : null}
    </div>
    </div>
      <div className="litrev-dock">
        {props.phase.kind === "setup" ? renderQuestionCard() : null}
        {props.phase.kind === "sources" ? renderSourceCard() : null}
        {renderComposer()}
      </div>
    </>
  );

  function renderVariableSummary(): ReactNode {
    return (
      <div className="litrev-qa-summary">
        {LEGAL_DIAG_QUESTIONS.map((question) => (
          <div key={question.id}>
            <small>{question.text}</small>
            <strong>{answers[question.id] || t("legalDiagnosis.question.skipped")}</strong>
          </div>
        ))}
      </div>
    );
  }

  function renderThinking(): ReactNode {
    const stage = props.phase.kind === "thinking" ? props.phase.stage : LEGAL_DIAG_THINKING_STAGES.length;
    return (
      <div className="litrev-stage-thinking-copy" aria-live="polite">
        <strong>{t("legalDiagnosis.stage.thinking")}</strong>
        {LEGAL_DIAG_THINKING_STAGES.map((label, index) => (
          <p key={label} className={index < stage ? "litrev-assistant-copy" : "litrev-assistant-copy litrev-assistant-copy--muted"}>
            {index < stage ? "✓ " : ""}{label}
          </p>
        ))}
      </div>
    );
  }

  function renderTodos(): ReactNode {
    return (
      <div className="litrev-todo">
        <div className="litrev-todo__toggle">
          <span>{props.phase.kind === "review" ? t("legalDiagnosis.stage.tasks.done") : t("legalDiagnosis.stage.tasks.generating")}</span>
        </div>
        <div className="litrev-todo__list litrev-stage-text-card">
          {LEGAL_DIAG_TODO_ITEMS.map((item, index) => {
            const done = index < todoProgress;
            const current = index === todoProgress && props.phase.kind === "task";
            return (
              <div key={item} className={`litrev-todo__item${done ? " litrev-todo__item--done" : ""}${current ? " litrev-todo__item--current" : ""}`}>
                <span className="litrev-todo__status">{done ? <Check size={12} /> : current ? "…" : ""}</span>
                <strong>{item}</strong>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderQuestionCard(): ReactNode {
    return (
      <section className="litrev-question-card" aria-label={t("legalDiagnosis.question.cardTitle")}>
        <header className="litrev-question-card__head">
          <h2>{t("legalDiagnosis.question.cardTitle")}</h2>
          <div className="litrev-question-card__meta">
            <span>{t("legalDiagnosis.question.count", { count: LEGAL_DIAG_QUESTIONS.length })}</span>
            <button type="button" aria-label={t("legalDiagnosis.workflow.close")} onClick={skipCurrentCard}>
              <X size={15} />
            </button>
          </div>
        </header>
        <div className="litrev-question-list">
          {LEGAL_DIAG_QUESTIONS.map((question) => {
            const saved = answers[question.id] ?? "";
            const supplement = question.freeText ? saved : (supplements[question.id] ?? "");
            const options = saved && question.options.length && !question.options.includes(saved)
              ? [...question.options, saved]
              : question.options;
            return (
              <section key={question.id} className="litrev-question-item">
                <div className="litrev-question-item__title">
                  <h3>{question.text}</h3>
                </div>
                {options.length ? (
                  <div className="litrev-question-options">
                    {options.map((option, optionIndex) => {
                      const selected = saved === option;
                      return (
                        <button
                          type="button"
                          key={option}
                          className={`litrev-question-option${selected ? " litrev-question-option--selected" : ""}`}
                          onClick={() => updateAnswer(question.id, option)}
                        >
                          <span className="litrev-question-option__number">{optionIndex + 1}</span>
                          <span className="litrev-question-option__label">{option}</span>
                          <span className="litrev-question-option__state">{selected ? <Check size={13} /> : <ChevronRight size={13} />}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <form
                  className="litrev-question-supplement"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const next = supplement.trim();
                    if (!next) return;
                    updateAnswer(question.id, next);
                    setSupplements((current) => ({ ...current, [question.id]: "" }));
                  }}
                >
                  <Pencil size={14} aria-hidden="true" />
                  <input
                    value={supplement}
                    placeholder={t("legalDiagnosis.question.supplementPlaceholder")}
                    aria-label={`${question.text}：${t("legalDiagnosis.question.supplementPlaceholder")}`}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (question.freeText) {
                        updateAnswer(question.id, value);
                        return;
                      }
                      setSupplements((current) => ({ ...current, [question.id]: value }));
                    }}
                  />
                  <button type="submit" aria-label={t("common.confirm")} disabled={!supplement.trim()}>
                    <ChevronRight size={14} />
                  </button>
                </form>
              </section>
            );
          })}
        </div>
        <footer className="litrev-question-card__foot">
          <Button type="button" variant="primary" size="sm" onClick={confirmSetup}>
            {t("common.confirm")}
          </Button>
        </footer>
      </section>
    );
  }

  function renderSourceCard(): ReactNode {
    return (
      <section className="litrev-wizard-card litrev-source-card" aria-label={t("legalDiagnosis.sources.title")}>
        <header className="litrev-wizard-card__head">
          <strong>{t("legalDiagnosis.sources.title")}</strong>
          <div className="litrev-wizard-card__head-actions">
            {sourceItems.length ? (
              <span className="litrev-wizard-card__count">
                {t("legalDiagnosis.sources.count", { count: sourceItems.length })}
              </span>
            ) : null}
            <button
              type="button"
              className="litrev-wizard-card__close"
              aria-label={t("legalDiagnosis.workflow.close")}
              onClick={skipCurrentCard}
            >
              <X size={15} />
            </button>
          </div>
        </header>
        <div className="litrev-wizard-card__body litrev-source-card__body">
          <p className="litrev-source-card__policy">{t("legalDiagnosis.sources.policy")}</p>
          {sourceItems.length ? (
            <div className="litrev-source-list">
              {sourceItems.map((item) => (
                <div className="litrev-source-list__row" key={item.id}>
                  <FileTypeIcon name={item.label} surface="row" />
                  <span className="litrev-source-list__name">{item.label}</span>
                  <small>{formatSourceSize(item.totalBytes)}</small>
                  <button
                    type="button"
                    aria-label={`${t("common.remove")}: ${item.label}`}
                    onClick={() => setSourceItems((current) => current.filter((entry) => entry.id !== item.id))}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="litrev-source-card__empty">{t("legalDiagnosis.sources.empty")}</div>
          )}
          {unsupportedCount ? (
            <p className="litrev-source-card__notice" role="alert">
              {t("legalDiagnosis.sources.unsupported", { count: unsupportedCount })}
            </p>
          ) : null}
          <div className="litrev-source-card__actions">
            <Button type="button" variant="secondary" size="sm" onClick={() => sourceFileInputRef.current?.click()}>
              <Plus size={12} /> {t("legalDiagnosis.sources.addFiles")}
            </Button>
          </div>
          <input
            ref={sourceFileInputRef}
            type="file"
            hidden
            multiple
            accept={LEGAL_DIAG_SOURCE_ACCEPT}
            onChange={handleSourceFilesPicked}
          />
        </div>
        <footer className="litrev-wizard-card__foot">
          <i />
          <Button type="button" variant="primary" size="sm" onClick={confirmSources}>
            {t(sourceItems.length ? "legalDiagnosis.sources.confirm" : "legalDiagnosis.sources.skip")}
          </Button>
        </footer>
      </section>
    );
  }

  function renderComposer(): ReactNode {
    const canSend = Boolean(props.composerDraft.trim());
    return (
      <div className="litrev-composer">
        <textarea
          rows={3}
          value={props.composerDraft}
          placeholder={t(props.phase.kind === "review" || props.phase.kind === "task"
            ? "legalDiagnosis.composer.task"
            : "legalDiagnosis.composer.setup")}
          onChange={(event) => props.onComposerDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submitComposer();
            }
          }}
        />
        <div className="litrev-composer__actions">
          <button
            type="button"
            className={`litrev-composer__send${canSend ? " litrev-composer__send--ready" : ""}`}
            aria-label={t("home.send")}
            disabled={!canSend}
            onClick={submitComposer}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    );
  }
}
