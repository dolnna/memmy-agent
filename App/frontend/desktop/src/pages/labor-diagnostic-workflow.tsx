/** On-demand collection cards, independent from diagnostic report progress. */

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type DragEvent, type MutableRefObject, type ReactNode } from "react";
import type { AsrTranscriptionResponse } from "@memmy/local-api-contracts";
import { Check, ChevronDown, ChevronRight, CircleDashed, FileDown, Folder, Mic, Minus, Pause, Pencil, Play, Plus, Send, Square, SquareSlash, X } from "lucide-react";
import { Button } from "../components/button.js";
import { FileTypeIcon } from "../components/file-type-icon.js";
import { useTranslation } from "../i18n/use-translation.js";
import { mergeVoiceTranscript, type AsrRecorder } from "./asr-recorder.js";
import {
  AgentCommandPalette,
  filterSlashCommands,
  readRecentSlashCommands,
  slashQueryFromInput,
  updateRecentSlashCommands,
  writeRecentSlashCommands,
  type SlashCommandPaletteItem
} from "./agent-command-palette.js";
import {
  normalizeLegalStructuredTranscriptSegments,
  type LegalRecordingPreviewState,
  type LegalStructuredTranscriptSegment
} from "./labor-recording-preview-pane.js";
import {
  LEGAL_DIAG_RECORDING_PATH,
  LEGAL_DIAG_TRANSCRIPT_PATH,
  LEGAL_DIAG_REPORT_PATH,
  legalMaterialWorkspacePath,
  type LegalDiagSourceItem
} from "./labor-diagnostic-workspace.js";
import {
  LEGAL_DIAG_SOURCE_ACCEPT,
  LEGAL_DIAGNOSIS_COMMAND,
  formatSourceSize,
  isLegalDiagSourceName,
  legalDiagConversationAction,
  type LegalDiagCard,
  type LegalDiagPhase
} from "./labor-diagnostic-model.js";
import { LegalDiagnosticTemplates } from "./labor-diagnostic-templates.js";
import {
  LEGAL_DIAG_ASSISTANT_INTRO,
  LEGAL_DIAG_EXECUTION_INTRO,
  LEGAL_DIAG_MESSAGE_ACK,
  LEGAL_DIAG_MISSING_INFO_INTRO,
  LEGAL_DIAG_MISSING_INFO_QUESTIONS,
  LEGAL_DIAG_RESULT_LINE,
  LEGAL_DIAG_THINKING_STAGES,
  LEGAL_DIAG_TODO_ITEMS,
  LEGAL_DIAG_TODO_OUTPUTS,
  LEGAL_DIAG_VERIFICATION_TODO_INDEX
} from "./labor-diagnostic-demo-data.js";

export const LEGAL_DIAG_THINKING_INTERVAL_MS = 420;
export const LEGAL_DIAG_TODO_INTERVAL_MS = 520;
export const LEGAL_DIAG_PREPARING_INTERVAL_MS = 560;

type LegalDiagAckPlacement = "setup" | "beforeResult" | "afterResult";

export interface LegalRecordingController {
  open(): void;
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  finish(): Promise<void>;
  upload(file: File): Promise<void>;
  addConversationFile(file: File): void;
}

export interface LaborDiagnosticWorkflowProps {
  prompt: string;
  sourceInput?: string;
  phase: LegalDiagPhase;
  onPhaseChange: (phase: LegalDiagPhase) => void;
  modelSelector?: ReactNode;
  slashCommands?: SlashCommandPaletteItem[];
  recorder: AsrRecorder;
  composerRecorder?: AsrRecorder;
  transcribeRecordingFile: (file: File) => Promise<AsrTranscriptionResponse>;
  onTranscriptReady: (transcript: string) => void;
  onRecordingPreviewChange?: (state: LegalRecordingPreviewState) => void;
  onOpenRecording?: () => void;
  recordingControllerRef?: MutableRefObject<LegalRecordingController | null>;
  onSourcesChange?: (items: LegalDiagSourceItem[]) => void;
  onOpenArtifact?: (path: string) => void;
  composerDraft: string;
  onComposerDraftChange: (value: string) => void;
  onComposerSubmit: (text: string) => void;
}

export function LaborDiagnosticWorkflow(props: LaborDiagnosticWorkflowProps) {
  const { t } = useTranslation();
  const sourceFileInputRef = useRef<HTMLInputElement | null>(null);
  const sourceFolderInputRef = useRef<HTMLInputElement | null>(null);
  const addPickedSourcesToComposerRef = useRef(true);
  const transcriptSequenceRef = useRef(0);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const activeCardContainerRef = useRef<HTMLDivElement | null>(null);
  const composerAttachMenuRef = useRef<HTMLDetailsElement | null>(null);
  const onPhaseChangeRef = useRef(props.onPhaseChange);
  onPhaseChangeRef.current = props.onPhaseChange;
  const [sourceItems, setSourceItems] = useState<LegalDiagSourceItem[]>([]);
  const [activeCard, setActiveCard] = useState<LegalDiagCard | null>("templates");
  const flowCardVisible = activeCard === "materials" || activeCard === "questions";
  const [notice, setNotice] = useState("");
  const [missingInfoAvailable, setMissingInfoAvailable] = useState(false);
  const recordingBusy = props.recorder.isRecording || props.recorder.isStarting || props.recorder.isTranscribing;
  const [composerContextIds, setComposerContextIds] = useState<string[]>([]);
  const [unsupportedCount, setUnsupportedCount] = useState(0);
  const [todoProgress, setTodoProgress] = useState(0);
  const [acks, setAcks] = useState<Array<{ id: number; text: string; placement: LegalDiagAckPlacement; reply?: string; files: LegalDiagSourceItem[] }>>([]);
  const ackSequenceRef = useRef(0);
  const [todoDetailsOpen, setTodoDetailsOpen] = useState(true);
  const [intakeDetailsOpen, setIntakeDetailsOpen] = useState(true);
  const [processDetailsOpen, setProcessDetailsOpen] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState("");
  const [composerVoiceError, setComposerVoiceError] = useState("");
  const [slashPickerOpen, setSlashPickerOpen] = useState(false);
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const [selectedSlashCommandIndex, setSelectedSlashCommandIndex] = useState(0);
  const [recentSlashCommands, setRecentSlashCommands] = useState(() => readRecentSlashCommands());
  const [uploadingRecording, setUploadingRecording] = useState(false);
  const [missingInfoAnswers, setMissingInfoAnswers] = useState<Record<string, string>>({});
  const [missingInfoSupplements, setMissingInfoSupplements] = useState<Record<string, string>>({});
  const [missingInfoCardStatus, setMissingInfoCardStatus] = useState<"open" | "submitted" | "dismissed">("open");
  const [missingInfoSummaryOpen, setMissingInfoSummaryOpen] = useState(false);
  const awaitingVerification = props.phase.kind === "task"
    && todoProgress === LEGAL_DIAG_VERIFICATION_TODO_INDEX
    && LEGAL_DIAG_MISSING_INFO_QUESTIONS.length > 0
    && missingInfoCardStatus === "open";

  useLayoutEffect(() => {
    const container = activeCardContainerRef.current;
    if (!container) return;
    container.scrollTop = 0;
    const questions = container.querySelector<HTMLElement>(".litrev-question-list");
    if (questions) questions.scrollTop = 0;
  }, [activeCard]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const scroll = conversationScrollRef.current;
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [acks.length, activeCard, props.phase.kind, missingInfoAvailable]);

  useEffect(() => {
    props.onSourcesChange?.(sourceItems);
  }, [props.onSourcesChange, sourceItems]);

  useEffect(() => () => {
    if (props.recordingControllerRef) props.recordingControllerRef.current = null;
  }, [props.recordingControllerRef]);

  useEffect(() => {
    if (props.phase.kind !== "preparing") return;
    const timer = window.setTimeout(() => {
      onPhaseChangeRef.current({ kind: "collecting" });
    }, LEGAL_DIAG_PREPARING_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [props.phase.kind]);

  useEffect(() => {
    if (props.phase.kind !== "thinking") return;
    if (props.phase.stage >= LEGAL_DIAG_THINKING_STAGES.length) {
      onPhaseChangeRef.current({ kind: "task" });
      return;
    }
    const stage = props.phase.stage;
    const timer = window.setTimeout(() => {
      onPhaseChangeRef.current({ kind: "thinking", stage: stage + 1 });
    }, LEGAL_DIAG_THINKING_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [props.phase]);

  useEffect(() => {
    if (props.phase.kind === "thinking") setIntakeDetailsOpen(true);
    if (props.phase.kind === "task" || props.phase.kind === "review") setIntakeDetailsOpen(false);
  }, [props.phase.kind]);

  useEffect(() => {
    if (props.phase.kind !== "task") return;
    if (awaitingVerification) {
      // The demo questions belong to this TODO; later work waits for the user.
      if (!missingInfoAvailable) {
        setMissingInfoAvailable(true);
        setActiveCard("questions");
      }
      return;
    }
    if (todoProgress >= LEGAL_DIAG_TODO_ITEMS.length) {
      setTodoDetailsOpen(false);
      onPhaseChangeRef.current({ kind: "review" });
      return;
    }
    const timer = window.setTimeout(() => setTodoProgress((value) => value + 1), LEGAL_DIAG_TODO_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [props.phase.kind, todoProgress, awaitingVerification, missingInfoAvailable]);

  useEffect(() => {
    if (props.recorder.status !== "recording") return;
    const timer = window.setInterval(() => setRecordSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [props.recorder.status]);

  useEffect(() => {
    const status = props.recorder.status;
    const mode = status === "recording"
      ? "recording"
      : status === "paused"
        ? "paused"
        : status === "transcribing"
          ? "transcribing"
          : status === "checkingPermission" || status === "requestingPermission" || status === "starting"
            ? "starting"
            : null;
    if (!mode) return;
    props.onRecordingPreviewChange?.({
      mode,
      elapsedSeconds: recordSeconds,
      transcript: "",
      transcriptSource: null
    });
  }, [props.onRecordingPreviewChange, props.recorder.status, recordSeconds]);

  async function startRecording() {
    openCard("recording");
    if (recordingBusy || uploadingRecording) {
      props.onOpenRecording?.();
      return;
    }
    setRecordingError("");
    setRecordSeconds(0);
    props.onRecordingPreviewChange?.({ mode: "starting", elapsedSeconds: 0, transcript: "", transcriptSource: null });
    try {
      await props.recorder.start();
    } catch (error) {
      setRecordingError(error instanceof Error ? error.message : String(error));
      props.onRecordingPreviewChange?.({ mode: "idle", elapsedSeconds: 0, transcript: "", transcriptSource: null });
    }
  }

  async function finishRecording() {
    setRecordingError("");
    props.onRecordingPreviewChange?.({ mode: "transcribing", elapsedSeconds: recordSeconds, transcript: "", transcriptSource: null });
    try {
      const result = await props.recorder.finishAndTranscribe();
      const segments = readStructuredSegments(result);
      const text = formatStructuredTranscript(segments) || result.text.trim();
      if (!text) {
        handleTranscriptionFailure(new Error(t("legalDiagnosis.recording.emptyTranscript")));
        return;
      }
      completeRecordingWithTranscript(text, segments);
    } catch (error) {
      handleTranscriptionFailure(error);
    }
  }

  async function uploadRecordingFile(file: File) {
    openCard("recording");
    if (recordingBusy || uploadingRecording) return;
    setRecordingError("");
    setUploadingRecording(true);
    setRecordSeconds(0);
    props.onRecordingPreviewChange?.({ mode: "transcribing", elapsedSeconds: 0, transcript: "", transcriptSource: null });
    try {
      const result = await props.transcribeRecordingFile(file);
      const segments = readStructuredSegments(result);
      const text = formatStructuredTranscript(segments) || result.text.trim();
      if (!text) {
        handleTranscriptionFailure(new Error(t("legalDiagnosis.recording.emptyTranscript")));
        return;
      }
      completeRecordingWithTranscript(text, segments);
    } catch (error) {
      handleTranscriptionFailure(error);
    } finally {
      setUploadingRecording(false);
    }
  }

  function completeRecordingWithTranscript(
    text: string,
    segments: LegalStructuredTranscriptSegment[] = []
  ) {
    setRecordingError("");
    setTranscript(text);
    props.onTranscriptReady(text);
    props.onRecordingPreviewChange?.({
      mode: "completed",
      elapsedSeconds: recordSeconds,
      transcript: text,
      transcriptSource: "asr",
      ...(segments.length ? { segments } : {})
    });
    let transcriptName: string;
    do {
      transcriptSequenceRef.current += 1;
      transcriptName = transcriptSequenceRef.current === 1
        ? "访谈转写.txt"
        : `访谈转写-${transcriptSequenceRef.current}.txt`;
    } while (sourceItems.some((item) => item.label === transcriptName));
    addSourceFiles([new File([`${text}\n`], transcriptName, { type: "text/plain" })], false);
    openCard("materials");
  }

  function handleTranscriptionFailure(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setRecordingError(message);
    props.onRecordingPreviewChange?.({
      mode: "completed",
      elapsedSeconds: recordSeconds,
      transcript: "",
      transcriptSource: null
    });
  }

  function startReport(captureComposer = true) {
    if (props.phase.kind === "thinking" || props.phase.kind === "task") return;
    if (recordingBusy || uploadingRecording) {
      openCard("recording");
      setNotice(t("legalDiagnosis.sources.finishRecordingFirst"));
      return;
    }
    const hasSupplement = acks.some((entry) => entry.text && !entry.text.startsWith("/") && !legalDiagConversationAction(entry.text));
    if (!sourceItems.length && !transcript && !hasSupplement) {
      openCard("materials");
      setNotice(t("legalDiagnosis.sources.needInput"));
      return;
    }
    if (captureComposer) {
      const files = sourceItems.filter((item) => composerContextIds.includes(item.id));
      const draft = props.composerDraft.trim();
      if (files.length || draft) {
        appendAck(draft, props.phase.kind === "review" ? "afterResult" : "setup", undefined, files);
        setComposerContextIds([]);
        props.onComposerDraftChange("");
        if (draft) props.onComposerSubmit(draft);
      }
    }
    setTodoProgress(0);
    setMissingInfoAvailable(false);
    setMissingInfoCardStatus("open");
    setMissingInfoAnswers({});
    setMissingInfoSupplements({});
    setActiveCard(null);
    setNotice("");
    props.onPhaseChange({ kind: "thinking", stage: 0 });
  }

  function openCard(card: LegalDiagCard) {
    if (card === "questions" && !missingInfoAvailable) {
      setNotice(t("legalDiagnosis.missingInfo.none"));
      return;
    }
    // Keep the current flow card in front, including when the preview opens recording.
    if (flowCardVisible && (card === "templates" || card === "recording")) return;
    composerAttachMenuRef.current?.removeAttribute("open");
    setActiveCard(card);
    setNotice("");
  }

  function dismissCard() {
    composerAttachMenuRef.current?.removeAttribute("open");
    setActiveCard(null);
    setNotice("");
  }

  function handleSourceFilesPicked(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    const addToComposer = addPickedSourcesToComposerRef.current;
    addPickedSourcesToComposerRef.current = true;
    addSourceFiles(files, addToComposer);
  }

  function addSourceFiles(files: File[], addToComposer = true) {
    const accepted = files.filter((file) => isLegalDiagSourceName(file.name));
    setUnsupportedCount(files.length - accepted.length);
    setNotice(accepted.length && addToComposer ? t("legalDiagnosis.sources.added", { count: accepted.length }) : "");
    const acceptedIds = accepted.map((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      return `${relativePath}:${file.size}:${file.lastModified}`;
    });
    if (addToComposer && acceptedIds.length) {
      setComposerContextIds((current) => [...new Set([...current, ...acceptedIds])]);
    }
    setSourceItems((current) => {
      const next = [...current];
      for (const file of accepted) {
        const relativePath = file.webkitRelativePath || file.name;
        const label = relativePath;
        const id = `${label}:${file.size}:${file.lastModified}`;
        if (!next.some((item) => item.id === id)) {
          next.push({
            id,
            label,
            relativePath,
            file,
            totalBytes: file.size,
            lastModified: file.lastModified
          });
        }
      }
      return next;
    });
  }

  function removeSourceItem(id: string) {
    if (!acks.some((entry) => entry.files.some((file) => file.id === id))) {
      setSourceItems((current) => current.filter((item) => item.id !== id));
    }
    setComposerContextIds((current) => current.filter((contextId) => contextId !== id));
  }

  function handleComposerSourceDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleComposerSourceDrop(event: DragEvent<HTMLDivElement>) {
    const files = event.dataTransfer.files.length
      ? [...event.dataTransfer.files]
      : [...event.dataTransfer.items].flatMap((item) => {
          const file = item.kind === "file" ? item.getAsFile() : null;
          return file ? [file] : [];
        });
    if (!files.length) return;
    event.preventDefault();
    addSourceFiles(files);
    composerInputRef.current?.focus();
  }

  function submitComposer() {
    const text = props.composerDraft.trim();
    const files = sourceItems.filter((item) => composerContextIds.includes(item.id));
    if (!text && !files.length) return;
    const action = legalDiagConversationAction(text);
    const placement: LegalDiagAckPlacement = props.phase.kind === "review"
      ? "afterResult"
      : props.phase.kind === "task" || props.phase.kind === "thinking"
        ? "beforeResult"
        : "setup";
    if (action === "dismiss") {
      if (awaitingVerification) dismissMissingInfo();
      else dismissCard();
    }
    else if (action === "generate") startReport(false);
    else if (action) openCard(action);
    else if (!awaitingVerification) dismissCard();
    const reply = action === "templates" ? t("legalDiagnosis.shortcuts.templatesReply")
      : action === "recording" ? t("legalDiagnosis.shortcuts.recordingReply")
      : action === "materials" ? t("legalDiagnosis.shortcuts.materialsReply")
      : action === "dismiss" ? t("legalDiagnosis.shortcuts.dismissReply")
      : action === "generate" ? t("legalDiagnosis.shortcuts.generateReply")
      : undefined;
    appendAck(text, placement, reply ?? (files.length ? t("legalDiagnosis.composer.filesReceived") : undefined), files);
    setComposerContextIds([]);
    props.onComposerSubmit(text);
    props.onComposerDraftChange("");
  }

  function appendAck(text: string, placement: LegalDiagAckPlacement, reply?: string, files: LegalDiagSourceItem[] = []) {
    ackSequenceRef.current += 1;
    setAcks((current) => [...current, {
      id: ackSequenceRef.current,
      text,
      files,
      placement,
      ...(reply ? { reply } : {})
    }]);
  }

  function confirmMissingInfo() {
    const answered = LEGAL_DIAG_MISSING_INFO_QUESTIONS.filter((question) => (
      Boolean(missingInfoAnswers[question.id]?.trim())
    ));
    if (!answered.length) return;
    setMissingInfoCardStatus("submitted");
    setActiveCard(null);
    setMissingInfoSummaryOpen(true);
    setNotice("");
  }

  function dismissMissingInfo() {
    setMissingInfoCardStatus("dismissed");
    setActiveCard(null);
  }

  if (props.recordingControllerRef) {
    props.recordingControllerRef.current = {
      open: () => openCard("recording"),
      start: startRecording,
      pause: () => props.recorder.pause(),
      resume: () => props.recorder.resume(),
      finish: finishRecording,
      upload: uploadRecordingFile,
      addConversationFile: (file) => {
        addSourceFiles([file]);
        window.requestAnimationFrame(() => composerInputRef.current?.focus());
      }
    };
  }

  const launchInput = props.sourceInput?.trim()
    || `${LEGAL_DIAGNOSIS_COMMAND}  ${props.prompt}`.trim();
  const launchParts = launchInput.split(/(\/legal-diagnosis\b)/gi);

  return (
    <>
      <div className="litrev-scroll" ref={conversationScrollRef}>
        <div className="litrev-conversation" data-testid="legal-diag-workflow">
          <div className="litrev-user-message">
            <div className="agent-chat-bubble agent-chat-bubble--user litrev-user-bubble">
              {launchParts.map((part, index) => (
                /^\/legal-diagnosis$/i.test(part)
                  ? <span key={`${part}:${index}`} className="litrev-user-command">{part}</span>
                  : part
              ))}
            </div>
          </div>
          {props.phase.kind === "preparing" ? (
            <div className="litrev-activity-history-item legal-launch-preparing" role="status">
              <CircleDashed size={12} className="litrev-spin" aria-hidden="true" />
              <span>{t("legalDiagnosis.stage.preparing")}</span>
            </div>
          ) : <p className="litrev-assistant-copy">{LEGAL_DIAG_ASSISTANT_INTRO}</p>}
          {acks.filter((entry) => entry.placement === "setup").map(renderAck)}

          {renderRecordingSummary()}
          {props.phase.kind === "thinking" || props.phase.kind === "task" || props.phase.kind === "review"
            ? renderMaterialsSummary()
            : null}
          {props.phase.kind === "thinking" || props.phase.kind === "task" || props.phase.kind === "review"
            ? <p className="litrev-assistant-copy">{LEGAL_DIAG_EXECUTION_INTRO}</p>
            : null}
          {props.phase.kind === "thinking" || props.phase.kind === "task" || props.phase.kind === "review"
            ? renderIntakeActivity(props.phase.kind !== "thinking")
            : null}
          {props.phase.kind === "task" || props.phase.kind === "review" ? renderTaskProcess() : null}
          {missingInfoAvailable && missingInfoCardStatus === "open" ? (
            <div className="legal-followup-note">
              <p className="litrev-assistant-copy">{LEGAL_DIAG_MISSING_INFO_INTRO}</p>
              {activeCard !== "questions" ? <button type="button" onClick={() => openCard("questions")}>{t("legalDiagnosis.missingInfo.open")}</button> : null}
            </div>
          ) : null}
          {props.phase.kind === "task" || props.phase.kind === "thinking" || props.phase.kind === "review"
            ? renderMissingInfoSummary()
            : null}
          {props.phase.kind === "thinking" || props.phase.kind === "task" || props.phase.kind === "review"
            ? acks.filter((entry) => entry.placement === "beforeResult").map(renderAck)
            : null}
          {props.phase.kind === "review" ? renderResult() : null}
          {props.phase.kind === "thinking" || props.phase.kind === "task" || props.phase.kind === "review"
            ? acks.filter((entry) => entry.placement === "afterResult").map(renderAck)
            : null}
        </div>
      </div>
      <div className="litrev-dock legal-workflow-dock">
        <div id="legal-active-card" ref={activeCardContainerRef} className={`legal-active-card${activeCard === "questions" ? " legal-active-card--questions" : ""}`}>
          {activeCard === "templates" ? <LegalDiagnosticTemplates onRecord={() => openCard("recording")} onUpload={() => openCard("materials")} onDismiss={dismissCard} /> : null}
          {activeCard === "recording" ? renderRecordingCard() : null}
          {activeCard === "materials" ? renderMaterialsCard() : null}
          {activeCard === "questions" && missingInfoAvailable ? renderMissingInfoCard() : null}
        </div>
        {notice ? <p className="legal-workflow-notice" role="status">{notice}</p> : null}
        {!flowCardVisible && (recordingBusy || uploadingRecording) && activeCard !== "recording" ? (
          <button type="button" className="legal-recording-indicator" onClick={() => openCard("recording")}>
            <Mic size={14} /><span>{uploadingRecording ? t("legalDiagnosis.recording.uploading") : recordingStatusLabel(props.recorder.status)}</span><time>{formatDuration(recordSeconds)}</time><ChevronRight size={13} />
          </button>
        ) : null}
        {!flowCardVisible ? <div className="legal-workflow-actions">
          <div className="legal-workflow-shortcuts" role="group" aria-label={t("legalDiagnosis.shortcuts.title")}>
            <button type="button" aria-expanded={activeCard === "templates"} aria-controls="legal-active-card" onClick={() => openCard("templates")}><FileDown size={14} />{t("legalDiagnosis.shortcuts.templates")}</button>
            <button type="button" aria-expanded={activeCard === "recording"} aria-controls="legal-active-card" onClick={() => openCard("recording")}><Mic size={14} />{t("legalDiagnosis.shortcuts.recording")}</button>
          </div>
        </div> : null}
        {renderComposer()}
        <input ref={sourceFileInputRef} type="file" hidden multiple accept={LEGAL_DIAG_SOURCE_ACCEPT} onChange={handleSourceFilesPicked} />
        <input
          ref={(node) => {
            sourceFolderInputRef.current = node;
            if (node) node.setAttribute("webkitdirectory", "");
          }}
          type="file"
          hidden
          multiple
          onChange={handleSourceFilesPicked}
        />
      </div>
    </>
  );

  function renderRecordingSummary(): ReactNode {
    if (transcript) {
      const label = t("legalDiagnosis.recording.completed");
      return (
        <div className="litrev-activity-history-item legal-recording-completed" role="status">
          <span className="legal-recording-completed__icon" aria-hidden="true"><Check size={11} /></span>
          <span>{label}</span>
        </div>
      );
    }
    return null;
  }

  function renderIntakeActivity(finished: boolean): ReactNode {
    const stage = props.phase.kind === "thinking" ? props.phase.stage : LEGAL_DIAG_THINKING_STAGES.length;
    const open = intakeDetailsOpen;
    return (
      <div className={`agent-activity-cluster litrev-stage-activity legal-intake-activity${finished ? "" : " agent-activity-cluster--running"}${open ? " agent-activity-cluster--open" : ""}`}>
        <button
          type="button"
          className="agent-activity-cluster__toggle litrev-status-toggle"
          aria-expanded={open}
          onClick={() => setIntakeDetailsOpen((value) => !value)}
        >
          <span>{t(finished ? "legalDiagnosis.stage.thinkingDone" : "legalDiagnosis.stage.thinking")}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        {open ? (
          <div className="agent-activity-cluster__body litrev-stage-activity__body legal-intake-steps" aria-live={finished ? undefined : "polite"}>
            {LEGAL_DIAG_THINKING_STAGES.map((label, index) => {
              const done = finished || index < stage;
              const current = !finished && index === stage;
              return (
                <div key={label} className={`legal-intake-step${done ? " legal-intake-step--done" : current ? " legal-intake-step--current" : ""}`}>
                  <span aria-hidden="true">{done ? <Check size={11} /> : current ? <CircleDashed size={11} className="litrev-spin" /> : null}</span>
                  <span>{label}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  function renderMaterialsSummary(): ReactNode {
    if (sourceItems.length > 0) return null;
    return (
      <div className="litrev-activity-history-item legal-materials-summary legal-materials-summary--skipped" role="status">
        <span className="legal-materials-summary__icon" aria-hidden="true">
          <Minus size={11} />
        </span>
        <span>{t("legalDiagnosis.sources.skippedStatus")}</span>
      </div>
    );
  }

  function renderAck(entry: { id: number; text: string; reply?: string; files: LegalDiagSourceItem[] }): ReactNode {
    return (
      <div key={entry.id} className="litrev-supplement">
        <div className="litrev-user-message">
          {entry.files.length ? (
            <div className="legal-message-files">
              {entry.files.map((file) => (
                <button type="button" className="legal-message-file" key={file.id} onClick={() => props.onOpenArtifact?.(legalMaterialWorkspacePath(file))}>
                  <FileTypeIcon name={file.label} surface="row" />
                  <span><strong>{file.label}</strong><small>{formatSourceSize(file.totalBytes)}</small></span>
                </button>
              ))}
            </div>
          ) : null}
          {entry.text ? <div className="agent-chat-bubble agent-chat-bubble--user litrev-user-bubble">{entry.text}</div> : null}
        </div>
        <p className="litrev-assistant-copy">{entry.reply ?? LEGAL_DIAG_MESSAGE_ACK}</p>
      </div>
    );
  }

  function renderTodos(): ReactNode {
    const total = LEGAL_DIAG_TODO_ITEMS.length;
    return (
      <div className="litrev-todo__list litrev-stage-text-card">
        {LEGAL_DIAG_TODO_ITEMS.map((item, index) => {
          const done = index < todoProgress;
          const current = index === todoProgress && todoProgress < total && props.phase.kind === "task";
          return (
            <div key={item} className={`litrev-todo__item${done ? " litrev-todo__item--done" : current ? " litrev-todo__item--current" : ""}`}>
              <span className="litrev-todo__status">
                {done ? <Check size={11} /> : current ? awaitingVerification ? <Pencil size={11} /> : <CircleDashed size={11} className="litrev-spin" /> : null}
              </span>
              <strong>{item}</strong>
              {current ? <small>{t(awaitingVerification ? "legalDiagnosis.stage.tasks.awaitingVerification" : "legalDiagnosis.stage.tasks.running")}</small> : null}
            </div>
          );
        })}
      </div>
    );
  }

  function renderTaskOutputMessages(): ReactNode {
    return LEGAL_DIAG_TODO_OUTPUTS.slice(0, todoProgress).map((message) => (
      <p key={message} className="litrev-assistant-copy litrev-task-output-message">{message}</p>
    ));
  }

  function renderTaskActivity(finished: boolean): ReactNode {
    const open = todoDetailsOpen;
    return (
      <div className={`agent-activity-cluster litrev-stage-activity${finished ? "" : " agent-activity-cluster--running"}${open ? " agent-activity-cluster--open" : ""}`}>
        <button
          type="button"
          className="agent-activity-cluster__toggle litrev-status-toggle"
          aria-expanded={open}
          onClick={() => setTodoDetailsOpen((value) => !value)}
        >
          <span>{t(finished ? "legalDiagnosis.stage.tasks.done" : "legalDiagnosis.stage.tasks.generating")}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        {open ? (
          <div className="agent-activity-cluster__body litrev-stage-activity__body min-w-0">
            {renderTodos()}
          </div>
        ) : null}
      </div>
    );
  }

  function renderTaskProcess(): ReactNode {
    const finished = props.phase.kind === "review";
    const processContent = (
      <>
        {renderTaskActivity(finished)}
        {renderTaskOutputMessages()}
      </>
    );
    if (!finished) return processContent;

    const duration = t("legalDiagnosis.stage.durationSeconds", {
      seconds: Math.max(1, Math.round((LEGAL_DIAG_TODO_ITEMS.length * LEGAL_DIAG_TODO_INTERVAL_MS) / 1000))
    });
    return (
      <div className={`agent-activity-cluster litrev-task-process${processDetailsOpen ? " agent-activity-cluster--open" : ""}`}>
        <button
          type="button"
          className="agent-activity-cluster__toggle litrev-status-toggle"
          aria-expanded={processDetailsOpen}
          onClick={() => setProcessDetailsOpen((value) => !value)}
        >
          <span>{t("agent.activity.workedFor", { duration })}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        {processDetailsOpen ? (
          <div className="agent-activity-cluster__body litrev-task-process__body">
            {processContent}
          </div>
        ) : null}
      </div>
    );
  }

  function renderResult(): ReactNode {
    const files = [
      ...(transcript ? [
        { path: LEGAL_DIAG_RECORDING_PATH, format: "M4A" },
        { path: LEGAL_DIAG_TRANSCRIPT_PATH, format: "TXT" }
      ] : []),
      { path: LEGAL_DIAG_REPORT_PATH, format: "DOCX" }
    ];
    return (
      <>
        <p className="litrev-assistant-copy">{LEGAL_DIAG_RESULT_LINE}</p>
        <div className="litrev-file-cards" aria-label={t("legalDiagnosis.result.title")}>
          {files.map((file) => (
            <button
              type="button"
              key={file.path}
              className="litrev-file-card"
              onClick={() => props.onOpenArtifact?.(file.path)}
            >
              <FileTypeIcon name={file.path} surface="card" />
              <span className="litrev-file-card__text">
                <strong>{file.path.split("/").pop()}</strong>
                <small>{file.format}</small>
              </span>
            </button>
          ))}
        </div>
        {missingInfoCardStatus === "dismissed"
          ? <p className="litrev-assistant-copy">{t("legalDiagnosis.missingInfo.dismissed")}</p>
          : null}
      </>
    );
  }

  function renderMissingInfoSummary(): ReactNode {
    if (missingInfoCardStatus !== "submitted") return null;
    const answers = LEGAL_DIAG_MISSING_INFO_QUESTIONS.map((question) => ({
      question: question.question,
      answer: missingInfoAnswers[question.id]?.trim() ?? ""
    })).filter((entry) => entry.answer);
    return (
      <div className={`agent-activity-cluster litrev-stage-activity${missingInfoSummaryOpen ? " agent-activity-cluster--open" : ""}`}>
        <button
          type="button"
          className="agent-activity-cluster__toggle litrev-status-toggle"
          aria-expanded={missingInfoSummaryOpen}
          onClick={() => setMissingInfoSummaryOpen((open) => !open)}
        >
          <span>{t("legalDiagnosis.missingInfo.submitted")}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        {missingInfoSummaryOpen ? (
          <div className="agent-activity-cluster__body litrev-stage-activity__body">
            <div className="litrev-qa-summary">
              {answers.map((entry) => (
                <div key={entry.question}>
                  <small>{entry.question}</small>
                  <strong>{entry.answer}</strong>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderMissingInfoCard(): ReactNode {
    const canSubmit = LEGAL_DIAG_MISSING_INFO_QUESTIONS.some((question) => Boolean(missingInfoAnswers[question.id]));
    return (
      <section className="litrev-question-card legal-missing-info-card" aria-label={t("legalDiagnosis.missingInfo.title")}>
        <header className="litrev-question-card__head">
          <h2>{t("legalDiagnosis.missingInfo.title")}</h2>
          <div className="litrev-question-card__meta">
            <span>{t("legalDiagnosis.missingInfo.count", { count: LEGAL_DIAG_MISSING_INFO_QUESTIONS.length })}</span>
            <button type="button" aria-label={t("legalDiagnosis.missingInfo.skip")} onClick={dismissMissingInfo}>
              <X size={15} />
              <span className="sr-only">{t("legalDiagnosis.missingInfo.skip")}</span>
            </button>
          </div>
        </header>
        <div className="litrev-question-list">
          {LEGAL_DIAG_MISSING_INFO_QUESTIONS.map((question) => {
            const savedAnswer = missingInfoAnswers[question.id] ?? "";
            const supplementDraft = missingInfoSupplements[question.id] ?? "";
            const options = savedAnswer && !question.options.includes(savedAnswer)
              ? [...question.options, savedAnswer]
              : question.options;
            return (
              <section key={question.id} className="litrev-question-item">
                <div className="litrev-question-item__title">
                  <h3>{question.question}</h3>
                </div>
                <div className="litrev-question-options" role="radiogroup" aria-label={question.question}>
                  {options.map((option, optionIndex) => {
                    const selected = missingInfoAnswers[question.id] === option;
                    return (
                      <button
                        type="button"
                        key={option}
                        role="radio"
                        aria-checked={selected}
                        className={`litrev-question-option${selected ? " litrev-question-option--selected" : ""}`}
                        onClick={() => setMissingInfoAnswers((answers) => ({ ...answers, [question.id]: option }))}
                      >
                        <span className="litrev-question-option__number">{optionIndex + 1}</span>
                        <span className="litrev-question-option__label">{option}</span>
                        <span className="litrev-question-option__state">{selected ? <Check size={13} /> : <ChevronRight size={13} />}</span>
                      </button>
                    );
                  })}
                </div>
                <form
                  className="litrev-question-supplement"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const supplement = supplementDraft.trim();
                    if (!supplement) return;
                    setMissingInfoAnswers((answers) => ({ ...answers, [question.id]: supplement }));
                    setMissingInfoSupplements((items) => ({ ...items, [question.id]: "" }));
                  }}
                >
                  <Pencil size={14} aria-hidden="true" />
                  <input
                    value={supplementDraft}
                    placeholder={t("legalDiagnosis.missingInfo.supplementPlaceholder")}
                    aria-label={`${question.question}：${t("legalDiagnosis.missingInfo.supplementPlaceholder")}`}
                    onChange={(event) => setMissingInfoSupplements((items) => ({
                      ...items,
                      [question.id]: event.target.value
                    }))}
                  />
                  <button type="submit" aria-label={t("common.confirm")} disabled={!supplementDraft.trim()}>
                    <ChevronRight size={14} />
                  </button>
                </form>
              </section>
            );
          })}
        </div>
        <footer className="litrev-question-card__foot">
          <Button type="button" variant="primary" size="sm" disabled={!canSubmit} onClick={confirmMissingInfo}>{t("common.confirm")}</Button>
        </footer>
      </section>
    );
  }

  function renderRecordingCard(): ReactNode {
    const status = props.recorder.status;
    const recording = status === "recording";
    const paused = status === "paused";
    const processing = props.recorder.isStarting || props.recorder.isTranscribing || uploadingRecording;
    const label = uploadingRecording ? t("legalDiagnosis.recording.uploading")
      : recording || paused || processing ? recordingStatusLabel(status)
      : t("legalDiagnosis.shortcuts.recording");
    return (
      <section className="litrev-wizard-card legal-record-card" aria-label={t("legalDiagnosis.shortcuts.recording")}>
        <div className={`legal-record-strip${recording ? " legal-record-strip--active" : ""}${paused ? " legal-record-strip--paused" : ""}`}>
          <span className="legal-record-strip__icon" aria-hidden="true">
            {processing ? <CircleDashed size={18} className="litrev-spin" /> : <Mic size={18} />}
          </span>
          <strong className="legal-record-strip__label" aria-live="polite">{label}</strong>
          <time className="legal-record-strip__time">{formatDuration(recordSeconds)}</time>
          <span className="legal-record-strip__wave" aria-hidden="true">
            {[4, 6, 10, 6, 14, 20, 12, 8, 18, 26, 16, 10, 22, 30, 18, 12, 24, 16, 8, 20, 26, 14, 10, 18, 12, 6, 10, 4].map((height, index) => (
              <i key={index} style={{ height, animationDelay: `${-index * 85}ms` }} />
            ))}
          </span>
          <div className="legal-record-strip__actions">
            {!recording && !paused && !processing ? (
              <Button type="button" variant="primary" size="sm" onClick={() => void startRecording()}>{t("legalDiagnosis.recording.start")}</Button>
            ) : null}
            {recording || paused ? (
              <>
                <Button type="button" variant="secondary" size="sm" onClick={() => paused ? props.recorder.resume() : props.recorder.pause()}>
                  {paused ? <Play size={13} /> : <Pause size={13} />}{t(paused ? "legalDiagnosis.recording.resume" : "legalDiagnosis.recording.pause")}
                </Button>
                <Button type="button" variant="primary" size="sm" onClick={() => void finishRecording()}>
                  <Square size={12} />{t("legalDiagnosis.recording.finish")}
                </Button>
              </>
            ) : null}
          </div>
          <button type="button" className="litrev-wizard-card__close" aria-label={t("legalDiagnosis.workflow.close")} onClick={dismissCard}><X size={15} /></button>
        </div>
        {recordingError ? <p className="legal-record-card__error legal-record-strip__error" role="alert">{recordingError}</p> : null}
      </section>
    );
  }

  function renderMaterialsCard(): ReactNode {
    const busy = recordingBusy || uploadingRecording || props.phase.kind === "thinking" || props.phase.kind === "task";
    return (
      <section
        className="litrev-wizard-card litrev-source-card"
        aria-label={t("legalDiagnosis.sources.title")}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          addSourceFiles([...event.dataTransfer.files], false);
        }}
      >
        <header className="litrev-wizard-card__head">
          <strong>{t("legalDiagnosis.sources.title")}</strong>
          <div className="litrev-wizard-card__head-actions">
            {sourceItems.length ? <span className="litrev-wizard-card__count">{t("legalDiagnosis.sources.count", { count: sourceItems.length })}</span> : null}
            <button type="button" className="litrev-wizard-card__close" aria-label={t("legalDiagnosis.workflow.close")} onClick={dismissCard}><X size={15} /></button>
          </div>
        </header>
        <div className="litrev-wizard-card__body litrev-source-card__body">
          <p className="litrev-source-card__policy">{t("legalDiagnosis.sources.policy")}</p>
          {sourceItems.length ? (
            <div className="litrev-source-list">
              {sourceItems.map((item) => (
                <div className="litrev-source-list__row legal-material-row" key={item.id}>
                  <button type="button" className="legal-material-file" title={item.label} onClick={() => props.onOpenArtifact?.(legalMaterialWorkspacePath(item))}>
                    <FileTypeIcon name={item.label} surface="row" />
                    <span className="legal-material-file__name">{item.label}</span>
                    <small>{formatSourceSize(item.totalBytes)}</small>
                  </button>
                  {!acks.some((entry) => entry.files.some((file) => file.id === item.id)) ? (
                    <button type="button" className="legal-material-remove" aria-label={`${t("common.remove")}: ${item.label}`} onClick={() => removeSourceItem(item.id)}><X size={13} /></button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <button type="button" className="litrev-source-card__empty legal-materials-dropzone" onClick={() => {
              addPickedSourcesToComposerRef.current = false;
              sourceFileInputRef.current?.click();
            }}>{t("legalDiagnosis.sources.empty")}</button>
          )}
          <div className="litrev-source-card__actions">
            <Button type="button" variant="secondary" size="sm" onClick={() => {
              addPickedSourcesToComposerRef.current = false;
              sourceFileInputRef.current?.click();
            }}><Plus size={12} />{t("legalDiagnosis.sources.addFiles")}</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => {
              addPickedSourcesToComposerRef.current = false;
              sourceFolderInputRef.current?.click();
            }}><Folder size={13} />{t("legalDiagnosis.sources.addFolder")}</Button>
          </div>
        </div>
        <footer className="litrev-wizard-card__foot">
          <small className="legal-materials-formats" title={t("legalDiagnosis.sources.formatsDetail")}>{t("legalDiagnosis.sources.formats")}</small>
          <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => startReport()}>{t("legalDiagnosis.sources.confirm")}</Button>
        </footer>
      </section>
    );
  }

  function renderComposer(): ReactNode {
    const canSend = Boolean(props.composerDraft.trim() || composerContextIds.length);
    const composerRecorder = props.composerRecorder;
    const composerContextItems = sourceItems.filter((item) => composerContextIds.includes(item.id));
    const slashQuery = slashMenuDismissed
      ? null
      : slashPickerOpen
        ? ""
        : slashQueryFromInput(props.composerDraft);
    const filteredSlashCommands = slashQuery === null
      ? []
      : filterSlashCommands(props.slashCommands ?? [], slashQuery, recentSlashCommands);
    const slashMenuOpen = filteredSlashCommands.length > 0;
    return (
      <div className="litrev-composer legal-chat-composer" onDragOver={handleComposerSourceDragOver} onDrop={handleComposerSourceDrop}>
        {composerContextItems.length ? (
          <div className="legal-composer-contexts" aria-label={t("legalDiagnosis.composer.attachments")}>
            {composerContextItems.map((item) => (
              <span key={item.id} className="legal-composer-context-chip" title={item.label}>
                <FileTypeIcon name={item.label} surface="inline" />
                <span>{item.label}</span>
                <button
                  type="button"
                  aria-label={`${t("common.remove")}: ${item.label}`}
                  onClick={() => removeSourceItem(item.id)}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {unsupportedCount ? <p className="litrev-composer__error" role="alert">{t("legalDiagnosis.sources.unsupported", { count: unsupportedCount })}</p> : null}
        <div className="legal-composer-input-region">
          <textarea
            ref={composerInputRef}
            rows={1}
            value={props.composerDraft}
            placeholder={t(props.phase.kind === "review" || props.phase.kind === "task" ? "legalDiagnosis.composer.task" : "legalDiagnosis.composer.setup")}
            onChange={(event) => {
              props.onComposerDraftChange(event.target.value);
              setSlashPickerOpen(false);
              setSlashMenuDismissed(false);
              setSelectedSlashCommandIndex(0);
            }}
            onKeyDown={(event) => {
              if (slashMenuOpen) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelectedSlashCommandIndex((index) => (index + 1) % filteredSlashCommands.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedSlashCommandIndex((index) => (index - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  const command = filteredSlashCommands[selectedSlashCommandIndex] ?? filteredSlashCommands[0];
                  if (command) selectComposerSlashCommand(command);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSlashMenuDismissed(true);
                  setSlashPickerOpen(false);
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitComposer();
              }
            }}
          />
        </div>
        <div className="legal-composer-toolbar">
          <div className="composer-quick-actions">
            <details ref={composerAttachMenuRef} className="agent-composer-attach-menu composer-quick-actions__anchor">
              <summary
                className="composer-quick-actions__btn"
                role="button"
                aria-label={t("home.quick.attach")}
                aria-haspopup="menu"
                title={t("home.quick.attachHint")}
                onClick={() => {
                  setSlashPickerOpen(false);
                  setSlashMenuDismissed(true);
                }}
              >
                <Plus size={15} />
              </summary>
              <div className="agent-composer-attach-menu__popover" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    addPickedSourcesToComposerRef.current = true;
                    sourceFileInputRef.current?.click();
                  }}
                >
                  {t("home.quick.uploadFile")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    addPickedSourcesToComposerRef.current = true;
                    sourceFolderInputRef.current?.click();
                  }}
                >
                  {t("home.quick.uploadFolder")}
                </button>
              </div>
            </details>
            <div className="composer-quick-actions__anchor">
              <button
                type="button"
                className={`composer-quick-actions__btn${slashPickerOpen ? " composer-action-btn--active" : ""}`}
                aria-label={t("home.quick.capability")}
                title={t("home.quick.capabilityHint")}
                aria-expanded={slashPickerOpen}
                aria-haspopup="listbox"
                onClick={() => {
                  composerAttachMenuRef.current?.removeAttribute("open");
                  setSlashMenuDismissed(false);
                  setSelectedSlashCommandIndex(0);
                  setSlashPickerOpen((open) => !open);
                  composerInputRef.current?.focus();
                }}
              >
                <SquareSlash size={15} strokeWidth={2} />
              </button>
              {slashMenuOpen ? (
                <div className="composer-quick-actions__popover composer-quick-actions__popover--slash">
                  <AgentCommandPalette
                    commands={filteredSlashCommands}
                    heading={t("home.commandPalette.commands")}
                    selectedIndex={Math.min(selectedSlashCommandIndex, filteredSlashCommands.length - 1)}
                    onSelect={selectComposerSlashCommand}
                  />
                </div>
              ) : null}
            </div>
          </div>
          {composerVoiceError ? <p className="litrev-composer__error" role="alert">{composerVoiceError}</p> : null}
          <div className="litrev-composer__actions">
            {props.modelSelector}
            {composerRecorder ? (
              <button
                type="button"
                className={`litrev-composer__voice${composerRecorder.isRecording ? " litrev-composer__voice--active" : ""}`}
                aria-label={t("home.voiceInput")}
                aria-pressed={composerRecorder.isRecording}
                title={t("home.voiceInput")}
                disabled={composerRecorder.isTranscribing || composerRecorder.isStarting}
                onClick={() => void toggleComposerVoiceInput()}
              >
                {composerRecorder.isRecording ? <Pause size={15} /> : <Mic size={15} />}
              </button>
            ) : null}
            <button type="button" className={`litrev-composer__send${canSend ? " litrev-composer__send--ready" : ""}`} aria-label={t("home.send")} disabled={!canSend} onClick={submitComposer}><Send size={14} /></button>
          </div>
        </div>
      </div>
    );
  }

  function selectComposerSlashCommand(command: SlashCommandPaletteItem) {
    const input = composerInputRef.current;
    const current = props.composerDraft;
    const selectionStart = input?.selectionStart ?? current.length;
    const selectionEnd = input?.selectionEnd ?? selectionStart;
    const beforeCaret = current.slice(0, selectionStart);
    const match = /(^|\s)\/[^\s/]*$/.exec(beforeCaret);
    const replaceStart = match
      ? (match.index ?? 0) + (match[1]?.length ?? 0)
      : selectionStart;
    const before = current.slice(0, replaceStart);
    const after = current.slice(selectionEnd);
    const leading = match || replaceStart === 0 || /\s$/.test(before) ? "" : " ";
    const trailing = /^\s/.test(after) ? "" : " ";
    const inserted = `${leading}${command.command}${trailing}`;
    const next = `${before}${inserted}${after}`;
    const caret = before.length + inserted.length;
    props.onComposerDraftChange(next);
    setSlashPickerOpen(false);
    setSlashMenuDismissed(true);
    setSelectedSlashCommandIndex(0);
    setRecentSlashCommands((recent) => {
      const updated = updateRecentSlashCommands(command.command, recent);
      writeRecentSlashCommands(updated);
      return updated;
    });
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
      composerInputRef.current?.setSelectionRange(caret, caret);
    });
  }

  async function toggleComposerVoiceInput() {
    const recorder = props.composerRecorder;
    if (!recorder) return;
    setComposerVoiceError("");
    try {
      if (recorder.isRecording) {
        const result = await recorder.finishAndTranscribe();
        const text = result.text.trim();
        if (!text) throw new Error(t("legalDiagnosis.recording.emptyTranscript"));
        props.onComposerDraftChange(mergeVoiceTranscript(props.composerDraft, text));
        window.requestAnimationFrame(() => composerInputRef.current?.focus());
        return;
      }
      composerInputRef.current?.focus();
      await recorder.start();
    } catch (error) {
      setComposerVoiceError(error instanceof Error ? error.message : String(error));
    }
  }

  function recordingStatusLabel(status: AsrRecorder["status"]): string {
    if (status === "recording") return t("legalDiagnosis.recording.recording");
    if (status === "paused") return t("legalDiagnosis.recording.paused");
    if (status === "transcribing") return t("legalDiagnosis.recording.transcribing");
    if (status === "checkingPermission" || status === "requestingPermission" || status === "starting") return t("legalDiagnosis.recording.starting");
    return t("legalDiagnosis.recording.ready");
  }
}

function readStructuredSegments(result: AsrTranscriptionResponse): LegalStructuredTranscriptSegment[] {
  return normalizeLegalStructuredTranscriptSegments(result.segments);
}

export function formatStructuredTranscript(segments: LegalStructuredTranscriptSegment[]): string {
  return segments.map((segment) => {
    const speaker = segment.speakerId === null ? "发言人" : `发言人 ${segment.speakerId + 1}`;
    return `${speaker}  ${formatTranscriptTimestamp(segment.startMs)}\n${segment.text.trim()}`;
  }).filter((entry) => entry.trim()).join("\n\n");
}

function formatTranscriptTimestamp(startMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
