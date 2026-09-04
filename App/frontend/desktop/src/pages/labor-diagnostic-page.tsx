/** Labor-employment diagnostic PoC page. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AsrRealtimeTranscriptEvent,
  AsrTranscriptionInput,
  AsrTranscriptionResponse
} from "@memmy/local-api-contracts";
import { AudioLines, PanelRight } from "lucide-react";
import { useApiClients } from "../app/providers.js";
import type { MemmyAgentSlashCommand, WorkspaceFilesListing } from "../api/memmy-agent-client.js";
import { AgentModelSelector } from "../components/agent-model-selector.js";
import { WorkspacePreviewPane } from "../components/workspace-preview-pane.js";
import { useTranslation } from "../i18n/use-translation.js";
import { useAppState } from "../state/app-state.js";
import { AppFrame } from "./app-frame.js";
import { localizeSlashCommands } from "./agent-command-palette.js";
import {
  blobToAudioBase64,
  useAsrRecorder
} from "./asr-recorder.js";
import {
  type LegalDiagPhase,
  readLegalDiagnosisPrompt,
  readLegalDiagnosisProjectContext,
  readLegalDiagnosisSourceInput
} from "./labor-diagnostic-model.js";
import {
  LegalRecordingCollectionPreview,
  recordingTranscriptSourceFile,
  type LegalRecordingAudioAsset,
  type LegalRecordingPreviewState,
  type LegalRecordingSurface,
  type LegalRecordingViewItem
} from "./labor-recording-preview-pane.js";
import {
  LEGAL_DIAG_RECORDING_TAB_ID,
  loadLegalDiagWorkspacePreview,
  type LegalDiagSourceItem,
  type LegalDiagWorkspaceState
} from "./labor-diagnostic-workspace.js";
import { LaborDiagnosticWorkflow, type LegalRecordingController } from "./labor-diagnostic-workflow.js";

const LEGAL_PROJECT_TEXT_PREVIEW_PATTERN = /\.(?:c|cc|cpp|css|csv|go|h|hpp|html?|ini|java|js|json|jsx|log|md|mjs|py|rb|rs|sh|sql|tex|toml|ts|tsx|txt|xml|ya?ml)$/i;
const LEGAL_PROJECT_TEXT_PREVIEW_MAX_CHARS = 512 * 1024;

export function LaborDiagnosticPage() {
  const { language, t } = useTranslation();
  const { clients } = useApiClients();
  const { state: appState } = useAppState();
  const [projectContextId] = useState(() => readLegalDiagnosisProjectContext());
  const selectedProject = projectContextId
    ? appState.agent.projects.find((project) => project.id === projectContextId) ?? null
    : null;
  const [recordingId, setRecordingId] = useState(() => `recording-${crypto.randomUUID()}`);
  const recordingIdRef = useRef(recordingId);
  const [recordingTitle, setRecordingTitle] = useState(() => t("legalDiagnosis.recording.preview.recordingTitle"));
  const [recordingCreatedAt, setRecordingCreatedAt] = useState(() => new Date().toISOString());
  const [recordingHistory, setRecordingHistory] = useState<LegalRecordingViewItem[]>([]);
  const [selectedRecordingId, setSelectedRecordingId] = useState(recordingId);
  const recordingControllerRef = useRef<LegalRecordingController | null>(null);
  const recordingOperationIdRef = useRef<string | null>(null);
  const [recordingSurface, setRecordingSurface] = useState<LegalRecordingSurface>("list");
  const [recordingAudio, setRecordingAudio] = useState<LegalRecordingAudioAsset | undefined>();
  const [recordingPreview, setRecordingPreview] = useState<LegalRecordingPreviewState>({
    mode: "idle",
    elapsedSeconds: 0,
    transcript: "",
    transcriptSource: null
  });
  const recordingSnapshotRef = useRef({
    id: recordingId,
    title: recordingTitle,
    createdAt: recordingCreatedAt,
    audio: recordingAudio,
    preview: recordingPreview
  });
  recordingIdRef.current = recordingId;
  recordingSnapshotRef.current = {
    id: recordingId,
    title: recordingTitle,
    createdAt: recordingCreatedAt,
    audio: recordingAudio,
    preview: recordingPreview
  };
  const retainCapturedAudio = useCallback((audio: { blob: Blob; mimeType: string; durationMs?: number; recordedAt: string }) => {
    const asset: LegalRecordingAudioAsset = {
      id: recordingIdRef.current,
      ...audio,
      name: recordingNameForMimeType(audio.mimeType)
    };
    recordingSnapshotRef.current = { ...recordingSnapshotRef.current, audio: asset };
    setRecordingAudio(asset);
  }, []);
  const recorder = useAsrRecorder(clients?.asr, {
    emptyAudioMessage: t("home.asrEmptyAudio"),
    onAudioCaptured: retainCapturedAudio,
    transcribeOptions: {
      diarizationEnabled: true
    },
    realtime: {
      enabled: true,
      languageHints: ["zh", "en"],
      onTranscript: (event) => setRecordingPreview((current) => {
        const next = appendRealtimeTranscript(current, event);
        recordingSnapshotRef.current = { ...recordingSnapshotRef.current, preview: next };
        return next;
      }),
      onError: (error) => setRecordingPreview((current) => {
        const next = { ...current, realtimeError: error.message };
        recordingSnapshotRef.current = { ...recordingSnapshotRef.current, preview: next };
        return next;
      })
    }
  });
  const composerRecorder = useAsrRecorder(clients?.asr, {
    emptyAudioMessage: t("home.asrEmptyAudio")
  });
  const [phase, setPhase] = useState<LegalDiagPhase>({ kind: "preparing" });
  const [composerDraft, setComposerDraft] = useState("");
  const [transcript, setTranscript] = useState("");
  const [sourceItems, setSourceItems] = useState<LegalDiagSourceItem[]>([]);
  const [slashCommands, setSlashCommands] = useState<MemmyAgentSlashCommand[]>([]);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [previewOpenRequest, setPreviewOpenRequest] = useState<{
    path: string;
    requestId: number;
    fileTreeOpen?: boolean;
  } | null>(null);
  const [prompt] = useState(() => readLegalDiagnosisPrompt());
  const [sourceInput] = useState(() => readLegalDiagnosisSourceInput());

  useEffect(() => {
    const client = clients?.memmyAgent;
    if (!client) {
      setSlashCommands([]);
      return;
    }
    let stale = false;
    void client.listSlashCommands()
      .then((commands) => {
        if (!stale) setSlashCommands(commands.filter((command) => command.command !== "/stop"));
      })
      .catch(() => {
        if (!stale) setSlashCommands([]);
      });
    return () => { stale = true; };
  }, [clients?.memmyAgent]);

  const localizedSlashCommands = useMemo(
    () => localizeSlashCommands(slashCommands, language, t),
    [language, slashCommands, t]
  );

  const openArtifact = useCallback((path: string, options?: { fileTreeOpen?: boolean }) => {
    setWorkspaceOpen(true);
    setPreviewOpenRequest((current) => ({
      path,
      requestId: (current?.requestId ?? 0) + 1,
      ...(options?.fileTreeOpen === undefined ? {} : { fileTreeOpen: options.fileTreeOpen })
    }));
  }, []);

  function toggleWorkspacePreview() {
    if (workspaceOpen) {
      setWorkspaceOpen(false);
      return;
    }
    setPreviewOpenRequest(null);
    setWorkspaceOpen(true);
  }

  const archiveCurrentRecording = useCallback(() => {
    const snapshot = recordingSnapshotRef.current;
    const state: LegalRecordingPreviewState = {
      ...snapshot.preview,
      ...(snapshot.audio ? { recording: snapshot.audio } : {})
    };
    if (!recordingHasContent(state)) return;
    const item: LegalRecordingViewItem = {
      id: snapshot.id,
      label: snapshot.title,
      createdAt: snapshot.createdAt,
      state
    };
    setRecordingHistory((current) => [
      ...current.filter((candidate) => candidate.id !== item.id),
      item
    ]);
  }, []);

  const beginRecordingItem = useCallback((preview: LegalRecordingPreviewState) => {
    archiveCurrentRecording();
    const id = `recording-${crypto.randomUUID()}`;
    const title = t("legalDiagnosis.recording.preview.recordingTitle");
    const createdAt = new Date().toISOString();
    recordingIdRef.current = id;
    recordingOperationIdRef.current = id;
    recordingSnapshotRef.current = { id, title, createdAt, audio: undefined, preview };
    setRecordingId(id);
    setSelectedRecordingId(id);
    setRecordingTitle(title);
    setRecordingCreatedAt(createdAt);
    setRecordingAudio(undefined);
    setRecordingPreview(preview);
    return id;
  }, [archiveCurrentRecording, t]);

  const transcribeRecordingFile = useCallback(async (file: File): Promise<AsrTranscriptionResponse> => {
    const id = recordingIdRef.current;
    const recordedAt = file.lastModified > 0 ? new Date(file.lastModified).toISOString() : new Date().toISOString();
    const audio: LegalRecordingAudioAsset = {
      id,
      blob: file,
      mimeType: file.type || inferAudioMimeType(file.name) || "audio/mpeg",
      recordedAt,
      name: file.name
    };
    const title = recordingTitleFromFileName(file.name);
    recordingSnapshotRef.current = {
      ...recordingSnapshotRef.current,
      id,
      title,
      audio
    };
    setRecordingAudio(audio);
    setRecordingTitle(title);
    if (!clients?.asr) throw new Error(t("legalDiagnosis.recording.uploadUnavailable"));
    const encoded = await blobToAudioBase64(file, t("home.asrEmptyAudio"));
    const transcribeInput: AsrTranscriptionInput = {
      audioBase64: encoded.audioBase64,
      mimeType: file.type || inferAudioMimeType(file.name) || encoded.mimeType,
      diarizationEnabled: true,
      fileName: file.name
    };
    return clients.asr.transcribe(transcribeInput);
  }, [clients?.asr, t]);

  const updateRecordingPreview = useCallback((next: LegalRecordingPreviewState) => {
    const beginsOperation = recordingOperationIdRef.current === null
      && (next.mode === "starting" || next.mode === "transcribing");
    if (beginsOperation) {
      beginRecordingItem(next);
    } else {
      const current = recordingSnapshotRef.current.preview;
      const preserveLiveTranscript = next.mode === "recording"
        || next.mode === "paused"
        || next.mode === "transcribing";
      const resolved = preserveLiveTranscript ? {
        ...next,
        transcript: current.transcript,
        transcriptSource: current.transcript ? "asr" as const : null,
        ...(current.liveSegments?.length ? { liveSegments: current.liveSegments } : {}),
        ...(current.realtimeError ? { realtimeError: current.realtimeError } : {})
      } : next;
      recordingSnapshotRef.current = { ...recordingSnapshotRef.current, preview: resolved };
      setRecordingPreview(resolved);
    }
    if (next.mode === "completed" || next.mode === "idle") recordingOperationIdRef.current = null;
    if (next.mode === "starting" || next.mode === "transcribing") {
      setRecordingSurface("session");
      openArtifact(LEGAL_DIAG_RECORDING_TAB_ID, { fileTreeOpen: false });
    }
  }, [beginRecordingItem, openArtifact]);

  const currentRecordingState = useMemo<LegalRecordingPreviewState>(() => ({
    ...recordingPreview,
    ...(recordingAudio ? { recording: recordingAudio } : {})
  }), [recordingAudio, recordingPreview]);

  const recordingItems = useMemo<LegalRecordingViewItem[]>(() => [
    ...recordingHistory.filter((item) => item.id !== recordingId),
    ...(recordingHasContent(currentRecordingState) ? [{
      id: recordingId,
      label: recordingTitle,
      createdAt: recordingCreatedAt,
      state: currentRecordingState
    }] : [])
  ], [currentRecordingState, recordingCreatedAt, recordingHistory, recordingId, recordingTitle]);

  const selectedRecording = recordingItems.find((item) => item.id === selectedRecordingId)
    ?? recordingItems.find((item) => item.id === recordingId)
    ?? recordingItems[0];

  const workspaceState = useMemo<LegalDiagWorkspaceState>(() => ({
    recordings: recordingItems.flatMap((item) => item.state.recording ? [{
      id: item.id,
      name: item.state.recording.name,
      size: item.state.recording.blob.size,
      modifiedAt: item.state.recording.recordedAt ?? item.createdAt ?? null
    }] : []),
    transcript,
    materials: sourceItems,
    outputsReady: phase.kind === "review"
  }), [phase.kind, recordingItems, sourceItems, transcript]);

  const workspaceRevision = useMemo(() => [
    phase.kind,
    ...recordingItems.map((item) => `${item.id}:${item.label}:${item.state.mode}:${item.state.recording?.blob.size ?? 0}`),
    transcript.length,
    ...sourceItems.map((item) => item.id)
  ].join(":"), [phase.kind, recordingItems, sourceItems, transcript.length]);

  const workspaceScope = useMemo(() => selectedProject
    ? { kind: "project" as const, key: selectedProject.id }
    : { kind: "workspace" as const }, [selectedProject]);
  const workspaceRootLabel = selectedProject?.name ?? t("workspacePreview.workspaceFolder");

  const loadDirectory = useCallback(async (_sessionKey: string, relativePath: string) => {
    if (clients?.memmyAgent) {
      return clients.memmyAgent.listWorkspaceFiles(workspaceScope, relativePath);
    }
    return {
      root: {
        kind: selectedProject ? "project" as const : "task" as const,
        label: workspaceRootLabel
      },
      path: relativePath,
      entries: [],
      truncated: false
    } satisfies WorkspaceFilesListing;
  }, [clients?.memmyAgent, selectedProject, workspaceRootLabel, workspaceScope]);

  const loadPreview = useCallback(async (relativePath: string) => {
    const legalPreview = await loadLegalDiagWorkspacePreview(relativePath, workspaceState);
    if (legalPreview || !clients?.memmyAgent) return legalPreview;
    try {
      const artifact = await clients.memmyAgent.resolveArtifact(relativePath, workspaceScope);
      const extension = artifact.name.includes(".") ? artifact.name.split(".").pop()?.toUpperCase() ?? "" : "";
      if (artifact.media_url && LEGAL_PROJECT_TEXT_PREVIEW_PATTERN.test(artifact.name)) {
        const response = await fetch(artifact.media_url);
        if (response.ok) {
          const text = (await response.text()).slice(0, LEGAL_PROJECT_TEXT_PREVIEW_MAX_CHARS);
          return { title: artifact.name, sections: [{ heading: extension || t("common.preview"), body: text || artifact.path }] };
        }
      }
      return {
        title: artifact.name,
        sections: [{
          heading: extension || t("common.preview"),
          body: `${t("workspacePreview.binaryUnavailable")}\n\n${artifact.path}`
        }]
      };
    } catch {
      return null;
    }
  }, [clients?.memmyAgent, t, workspaceScope, workspaceState]);

  const renderWorkspacePreview = useCallback((path: string) => {
    if (path !== LEGAL_DIAG_RECORDING_TAB_ID) return undefined;
    const selectedState = selectedRecording?.state ?? {
      mode: "idle" as const,
      elapsedSeconds: 0,
      transcript: "",
      transcriptSource: null
    };
    return (
      <LegalRecordingCollectionPreview
        surface={recordingSurface}
        items={recordingItems}
        activeState={selectedState}
        activeLabel={selectedRecording?.label ?? t("legalDiagnosis.recording.preview.recordingTitle")}
        onStart={() => {
          setRecordingSurface("session");
          void recordingControllerRef.current?.start();
        }}
        onSelect={(id) => {
          setSelectedRecordingId(id);
          setRecordingSurface("session");
        }}
        onRename={(id, name) => {
          const title = name.trim();
          if (!title) return;
          if (id === recordingId) setRecordingTitle(title);
          setRecordingHistory((current) => current.map((item) => item.id === id ? { ...item, label: title } : item));
        }}
        onAddToConversation={(item) => {
          const file = recordingTranscriptSourceFile(item);
          if (file) recordingControllerRef.current?.addConversationFile(file);
        }}
        onBack={() => setRecordingSurface("list")}
        onPause={() => recordingControllerRef.current?.pause()}
        onResume={() => recordingControllerRef.current?.resume()}
        onFinish={() => void recordingControllerRef.current?.finish()}
      />
    );
  }, [phase.kind, recordingId, recordingItems, recordingSurface, selectedRecording, t]);

  const title = phase.kind === "thinking" || phase.kind === "task"
    ? t("legalDiagnosis.title.execution")
    : phase.kind === "review"
      ? t("legalDiagnosis.title.result")
      : t("legalDiagnosis.title.setup");

  return (
    <AppFrame title={t("nav.legalDiagnosis")} reserveTopBar={false}>
      <section className="litrev-split">
        <button
          type="button"
          className="litrev-workspace-toggle litrev-recording-toggle"
          aria-label={t("legalDiagnosis.recording.library.open")}
          title={t("legalDiagnosis.recording.library.open")}
          onClick={() => {
            setRecordingSurface("list");
            openArtifact(LEGAL_DIAG_RECORDING_TAB_ID, { fileTreeOpen: false });
          }}
        >
          <AudioLines size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`litrev-workspace-toggle${workspaceOpen ? " litrev-workspace-toggle--active" : ""}`}
          aria-label={t("common.preview")}
          aria-pressed={workspaceOpen}
          onClick={toggleWorkspacePreview}
        >
          <PanelRight size={15} />
        </button>
        <div className={`litrev-chat-pane${workspaceOpen ? " litrev-chat-pane--with-side" : ""}`}>
          <header className="litrev-chat-pane__topbar">
            <h1 className="agent-conversation-title">{title}</h1>
          </header>
          <LaborDiagnosticWorkflow
            prompt={prompt}
            sourceInput={sourceInput}
            phase={phase}
            onPhaseChange={setPhase}
            modelSelector={(
              <AgentModelSelector
                mode={appState.bootstrap?.app.userMode === "byok" ? "byok" : "account"}
                scopeKey="legal-diagnosis"
                disabled={phase.kind === "thinking" || phase.kind === "task"}
                seedConfig={appState.modelConfig}
              />
            )}
            slashCommands={localizedSlashCommands}
            recorder={recorder}
            composerRecorder={composerRecorder}
            transcribeRecordingFile={transcribeRecordingFile}
            onTranscriptReady={(next) => setTranscript((current) => current ? `${current}\n\n${next}` : next)}
            onRecordingPreviewChange={updateRecordingPreview}
            onOpenRecording={() => {
              setSelectedRecordingId(recordingId);
              setRecordingSurface("session");
              openArtifact(LEGAL_DIAG_RECORDING_TAB_ID, { fileTreeOpen: false });
            }}
            recordingControllerRef={recordingControllerRef}
            onSourcesChange={setSourceItems}
            onOpenArtifact={openArtifact}
            composerDraft={composerDraft}
            onComposerDraftChange={setComposerDraft}
            onComposerSubmit={() => undefined}
          />
        </div>
        {workspaceOpen ? (
          <WorkspacePreviewPane
            sessionKey="legal-diagnosis:task"
            rootLabel={workspaceRootLabel}
            loadDirectory={loadDirectory}
            loadPreview={loadPreview}
            refreshKey={`${workspaceRevision}:${clients?.memmyAgent ? "ready" : "waiting"}:${workspaceRootLabel}`}
            previewRevision={workspaceRevision}
            openRequest={previewOpenRequest}
            autoSelectInitialFile={false}
            renderPreview={renderWorkspacePreview}
            emptyLabel={t(selectedProject
              ? "workspacePreview.projectDirectoryEmpty"
              : "workspacePreview.workspaceDirectoryEmpty")}
            emptyDetail={workspaceRootLabel}
          />
        ) : null}
      </section>
    </AppFrame>
  );
}

function appendRealtimeTranscript(
  state: LegalRecordingPreviewState,
  event: AsrRealtimeTranscriptEvent
): LegalRecordingPreviewState {
  const current = state.liveSegments ?? [];
  const existingIndex = current.findIndex((candidate) => candidate.sentenceId === event.sentenceId);
  const liveSegments = existingIndex >= 0
    ? current.map((candidate, index) => index === existingIndex ? event : candidate)
    : [...current, event];
  liveSegments.sort((left, right) => left.sentenceId - right.sentenceId);
  return {
    ...state,
    transcript: liveSegments.map((segment) => segment.text.trim()).filter(Boolean).join("\n"),
    transcriptSource: "asr",
    liveSegments,
    realtimeError: undefined
  };
}

function inferAudioMimeType(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "m4a" || extension === "mp4") return "audio/mp4";
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "wav") return "audio/wav";
  if (extension === "webm") return "audio/webm";
  return "";
}

function recordingNameForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("mp4")) return "现场访谈录音.m4a";
  if (normalized.includes("mpeg")) return "现场访谈录音.mp3";
  if (normalized.includes("wav")) return "现场访谈录音.wav";
  return "现场访谈录音.webm";
}

function recordingTitleFromFileName(name: string): string {
  const normalized = name.trim();
  const lastDot = normalized.lastIndexOf(".");
  return lastDot > 0 ? normalized.slice(0, lastDot) : normalized || "访谈录音";
}

function recordingHasContent(state: LegalRecordingPreviewState): boolean {
  return Boolean(
    state.recording
    || state.transcript.trim()
    || state.mode !== "idle"
  );
}
