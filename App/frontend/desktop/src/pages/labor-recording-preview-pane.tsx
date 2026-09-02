/** Right-side recording and transcript preview for the labor diagnostic PoC. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type ReactNode } from "react";
import type {
  AsrRealtimeTranscriptEvent,
  AsrTranscriptSegment,
  AsrTranscriptWord
} from "@memmy/local-api-contracts";
import { ChevronLeft, MessageSquarePlus, Mic, Pause, Pencil, Play, Square, Upload } from "lucide-react";
import { Button } from "../components/button.js";
import { classifyAgentAttachmentFile, safeAgentAttachmentFilename } from "../lib/agent-attachment.js";
import { useTranslation } from "../i18n/use-translation.js";
import { SidebarResizeHandle, useResizableSidebar } from "./sidebar-resize.js";

export type LegalRecordingPreviewMode = "idle" | "starting" | "recording" | "paused" | "transcribing" | "completed";

export interface LegalRecordingAudioAsset {
  id: string;
  blob: Blob;
  mimeType: string;
  durationMs?: number;
  recordedAt?: string;
  name: string;
}

export interface LegalRecordingPreviewState {
  mode: LegalRecordingPreviewMode;
  elapsedSeconds: number;
  transcript: string;
  transcriptSource: "asr" | null;
  segments?: LegalStructuredTranscriptSegment[];
  liveSegments?: AsrRealtimeTranscriptEvent[];
  realtimeError?: string;
  recording?: LegalRecordingAudioAsset;
}

export type LegalStructuredTranscriptSegment = AsrTranscriptSegment;

export interface LegalTranscriptSegment {
  id: string;
  speaker: string;
  speakerNumber: number;
  time: string;
  startMs: number;
  text: string;
}

export interface LegalRecordingViewItem {
  id: string;
  label: string;
  createdAt?: string;
  state: LegalRecordingPreviewState;
}

export type LegalRecordingSurface = "list" | "session";

export function orderLegalRecordingItems(items: LegalRecordingViewItem[]): LegalRecordingViewItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftTime = recordingTimestamp(left.item);
      const rightTime = recordingTimestamp(right.item);
      return rightTime - leftTime || left.index - right.index;
    })
    .map(({ item }) => item);
}

export function recordingTranscriptSourceFile(item: LegalRecordingViewItem): File | null {
  const transcript = item.state.transcript.trim();
  if (!transcript || item.state.mode !== "completed") return null;
  const recordedAt = validRecordingDate(item.state.recording?.recordedAt)
    ?? validRecordingDate(item.createdAt);
  const baseName = item.label.replace(/\.[^.]+$/, "") || "访谈录音";
  const content = `${transcript}\n`;
  const provisional = new File([content], `${baseName}-转写.txt`, { type: "text/plain" });
  const classification = classifyAgentAttachmentFile(provisional);
  if (!classification) return null;
  return new File(
    [content],
    safeAgentAttachmentFilename(provisional.name, classification),
    { type: "text/plain", lastModified: recordedAt ? new Date(recordedAt).getTime() : 0 }
  );
}

export interface LegalRecordingCollectionPreviewProps {
  surface: LegalRecordingSurface;
  items: LegalRecordingViewItem[];
  activeState: LegalRecordingPreviewState;
  activeLabel: string;
  canSkip?: boolean;
  onStart: () => void;
  onUpload: (file: File) => void;
  onSkip?: () => void;
  onSelect: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onAddToConversation?: (item: LegalRecordingViewItem) => void;
  onBack: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
}

export function parseLegalTranscript(transcript: string): LegalTranscriptSegment[] {
  const lines = transcript.split(/\r?\n/).map((line) => line.trim());
  const segments: LegalTranscriptSegment[] = [];
  let current: LegalTranscriptSegment | null = null;
  for (const line of lines) {
    if (!line || /^\[POC 演示数据/.test(line)) continue;
    const heading = /^发言人\s*(\d+)\s+(\d{2}:\d{2})$/.exec(line);
    if (heading) {
      if (current?.text) segments.push(current);
      const speakerNumber = Number(heading[1] ?? 1);
      current = {
        id: `speaker-${speakerNumber}-${heading[2]}`,
        speaker: `发言人 ${speakerNumber}`,
        speakerNumber,
        time: heading[2] ?? "00:00",
        startMs: parseTranscriptTime(heading[2] ?? "00:00"),
        text: ""
      };
      continue;
    }
    if (!current) {
      current = { id: "speaker-1-00:00", speaker: "发言人 1", speakerNumber: 1, time: "00:00", startMs: 0, text: line };
    } else {
      current.text = current.text ? `${current.text}\n${line}` : line;
    }
  }
  if (current?.text) segments.push(current);
  return segments;
}

export function normalizeLegalStructuredTranscriptSegments(value: unknown): LegalStructuredTranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const segment = item as Record<string, unknown>;
    const id = typeof segment.id === "string" ? segment.id.trim() : "";
    const speakerId = segment.speakerId;
    const startMs = segment.startMs;
    const endMs = segment.endMs;
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    if (
      !id
      || (speakerId !== null && (!Number.isInteger(speakerId) || Number(speakerId) < 0))
      || !Number.isInteger(startMs)
      || Number(startMs) < 0
      || !Number.isInteger(endMs)
      || Number(endMs) < Number(startMs)
      || !text
    ) {
      return [];
    }
    return [{
      id,
      speakerId: speakerId === null ? null : Number(speakerId),
      startMs: Number(startMs),
      endMs: Number(endMs),
      text,
      words: normalizeStructuredWords(segment.words)
    }];
  }).sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

export function resolveLegalTranscriptSegments(
  transcript: string,
  structuredSegments: LegalStructuredTranscriptSegment[] | undefined
): LegalTranscriptSegment[] {
  if (!structuredSegments?.length) return parseLegalTranscript(transcript);
  return structuredSegments.map((segment) => {
    const speakerNumber = segment.speakerId === null ? 1 : segment.speakerId + 1;
    return {
      id: segment.id,
      speaker: `发言人 ${speakerNumber}`,
      speakerNumber,
      time: formatClock(segment.startMs / 1000),
      startMs: segment.startMs,
      text: segment.text
    };
  });
}

function normalizeStructuredWords(value: unknown): AsrTranscriptWord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const word = item as Record<string, unknown>;
    const text = typeof word.text === "string" ? word.text : "";
    const startMs = word.startMs;
    const endMs = word.endMs;
    if (
      !Number.isInteger(startMs)
      || Number(startMs) < 0
      || !Number.isInteger(endMs)
      || Number(endMs) < Number(startMs)
    ) return [];
    return [{ text, startMs: Number(startMs), endMs: Number(endMs) }];
  });
}

export function LegalRecordingPreviewPane(props: { state: LegalRecordingPreviewState }): ReactNode {
  const { t } = useTranslation();
  const previewResize = useResizableSidebar({
    storageKey: "memmy.workspacePreview.width",
    defaultWidth: 520,
    minWidth: 360,
    maxWidth: 760,
    resizeDirection: -1
  });

  return (
    <>
      <SidebarResizeHandle
        label={t("workspacePreview.resize")}
        width={previewResize.width}
        minWidth={previewResize.minWidth}
        maxWidth={previewResize.maxWidth}
        isResizing={previewResize.isResizing}
        onResizeStart={previewResize.beginResize}
        onResizeBy={previewResize.resizeBy}
      />
      <aside className="litrev-preview-pane litrev-preview-pane--lifted legal-recording-preview" style={previewResize.sidebarStyle}>
        <header className="litrev-preview-toolbar legal-recording-preview__toolbar">
          <strong>{t(props.state.mode === "completed" ? "legalDiagnosis.recording.preview.recordingTitle" : "legalDiagnosis.recording.preview.liveTitle")}</strong>
        </header>
        <LegalRecordingPreviewContent state={props.state} />
      </aside>
    </>
  );
}

/** Aggregated recording view: list first, then live/detail inside the same preview tab. */
export function LegalRecordingCollectionPreview(props: LegalRecordingCollectionPreviewProps): ReactNode {
  const { t } = useTranslation();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const cancelRenameRef = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const busy = [props.activeState, ...props.items.map((item) => item.state)].some((state) => (
    state.mode === "starting"
    || state.mode === "recording"
    || state.mode === "paused"
    || state.mode === "transcribing"
  ));

  if (props.surface === "list") {
    const orderedItems = orderLegalRecordingItems(props.items);
    return (
      <div className="legal-recording-library">
        <header className="legal-recording-library__toolbar">
          <strong>{t("legalDiagnosis.recording.library.title")}</strong>
          <div>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => uploadInputRef.current?.click()}>
              <Upload size={13} /> {t("legalDiagnosis.recording.upload")}
            </Button>
            <Button type="button" variant="primary" size="sm" disabled={busy} onClick={props.onStart}>
              <Mic size={13} /> {t("legalDiagnosis.recording.start")}
            </Button>
          </div>
        </header>
        <div className="litrev-file-list legal-recording-library__list">
          {orderedItems.length ? orderedItems.map((item) => {
            const participants = recordingParticipantCount(item.state);
            const transcriptReady = item.state.mode === "completed" && Boolean(item.state.transcript.trim());
            const saveRename = () => {
              if (cancelRenameRef.current) {
                cancelRenameRef.current = false;
                setEditingId(null);
                setDraftName("");
                return;
              }
              const name = draftName.trim();
              if (name) props.onRename?.(item.id, name);
              setEditingId(null);
              setDraftName("");
            };
            return (
              <div
                key={item.id}
                className={`litrev-file-item legal-recording-library__item${editingId === item.id ? " legal-recording-library__item--editing" : ""}`}
              >
                <button
                  type="button"
                  className="legal-recording-library__play"
                  aria-label={t("legalDiagnosis.recording.library.openNamed", { name: item.label })}
                  onClick={() => props.onSelect(item.id)}
                >
                  <Play size={15} />
                </button>
                {editingId === item.id ? (
                  <form className="legal-recording-library__rename" onSubmit={(event) => { event.preventDefault(); saveRename(); }}>
                    <input
                      autoFocus
                      maxLength={80}
                      aria-label={t("legalDiagnosis.recording.library.rename")}
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={saveRename}
                      onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        event.preventDefault();
                        cancelRenameRef.current = true;
                        setEditingId(null);
                        setDraftName("");
                      }}
                    />
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className="legal-recording-library__item-main"
                      draggable={transcriptReady}
                      onDragStart={(event) => startConversationFileDrag(event, item)}
                      onClick={() => props.onSelect(item.id)}
                    >
                      <span className="legal-recording-library__item-copy">
                        <strong>{item.label}</strong>
                        <small className="legal-recording-library__item-meta">
                          <time>{formatRecordingDate(recordingDateValue(item), t("legalDiagnosis.recording.library.unknownTime"))}</time>
                          <span>{t("legalDiagnosis.recording.library.duration", { duration: formatClock(recordingDurationSeconds(item.state)) })}</span>
                          <span>{participants === null
                            ? t("legalDiagnosis.recording.library.participantsUnknown")
                            : t("legalDiagnosis.recording.library.participants", { count: participants })}</span>
                          <span>{recordingListStatus(item.state, t)}</span>
                        </small>
                      </span>
                    </button>
                    <span className="legal-recording-library__item-actions">
                      {props.onAddToConversation ? (
                        <button
                          type="button"
                          className="legal-recording-library__add-button"
                          aria-label={t("legalDiagnosis.recording.library.addNamed", { name: item.label })}
                          title={transcriptReady
                            ? t("legalDiagnosis.recording.library.addToConversation")
                            : t("legalDiagnosis.recording.library.transcriptPending")}
                          disabled={!transcriptReady}
                          onClick={() => props.onAddToConversation?.(item)}
                        >
                          <MessageSquarePlus size={13} />
                          <span>{t("legalDiagnosis.recording.library.addToConversation")}</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="legal-recording-library__rename-button"
                        aria-label={t("legalDiagnosis.recording.library.renameNamed", { name: item.label })}
                        onClick={() => {
                          cancelRenameRef.current = false;
                          setEditingId(item.id);
                          setDraftName(item.label);
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                    </span>
                  </>
                )}
              </div>
            );
          }) : (
            <div className="litrev-preview-empty legal-recording-library__empty">
              <Mic size={24} aria-hidden="true" />
              <strong>{t("legalDiagnosis.recording.library.empty")}</strong>
            </div>
          )}
        </div>
        {props.canSkip && props.onSkip ? (
          <button type="button" className="legal-recording-library__skip" onClick={props.onSkip}>{t("legalDiagnosis.recording.skip")}</button>
        ) : null}
        <input
          ref={uploadInputRef}
          type="file"
          hidden
          accept="audio/*,.wav,.m4a,.mp3,.mp4,.webm"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) props.onUpload(file);
          }}
        />
      </div>
    );

    function startConversationFileDrag(event: ReactDragEvent<HTMLElement>, item: LegalRecordingViewItem) {
      const file = recordingTranscriptSourceFile(item);
      if (!file) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("application/x-memmy-recording-transcript", item.id);
      event.dataTransfer.setData("text/plain", file.name);
      try {
        if (!event.dataTransfer.items.add(file)) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    }
  }

  const recording = props.activeState.mode === "recording";
  const paused = props.activeState.mode === "paused";
  return (
    <div className="legal-recording-session">
      <header className="legal-recording-session__toolbar">
        <button type="button" className="litrev-file-browser__toggle" aria-label={t("legalDiagnosis.recording.library.back")} onClick={props.onBack}>
          <ChevronLeft size={16} />
        </button>
        <strong>{props.activeLabel}</strong>
        <div>
          {recording || paused ? (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={paused ? props.onResume : props.onPause}>
                {paused ? <Play size={13} /> : <Pause size={13} />}{t(paused ? "legalDiagnosis.recording.resume" : "legalDiagnosis.recording.pause")}
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={props.onFinish}>
                <Square size={12} /> {t("legalDiagnosis.recording.finish")}
              </Button>
            </>
          ) : null}
        </div>
      </header>
      <LegalRecordingPreviewContent state={props.activeState} />
    </div>
  );
}

/** Player/transcript body that can live inside the shared workspace preview. */
export function LegalRecordingPreviewContent(props: { state: LegalRecordingPreviewState }): ReactNode {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const segments = useMemo(
    () => resolveLegalTranscriptSegments(props.state.transcript, props.state.segments),
    [props.state.segments, props.state.transcript]
  );
  const recordedDuration = props.state.recording?.durationMs === undefined
    ? 0
    : Math.max(0, Math.round(props.state.recording.durationMs / 1000));
  const durationSeconds = Math.max(mediaDuration, recordedDuration, props.state.elapsedSeconds);
  const progressPercent = durationSeconds > 0 ? Math.min(100, (currentSeconds / durationSeconds) * 100) : 0;

  useEffect(() => {
    const blob = props.state.recording?.blob;
    setPlaying(false);
    setCurrentSeconds(0);
    setMediaDuration(0);
    if (!blob || typeof URL.createObjectURL !== "function") {
      setAudioUrl("");
      return;
    }
    const nextUrl = URL.createObjectURL(blob);
    setAudioUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [props.state.recording?.blob]);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (audio.paused) {
      await audio.play().catch(() => undefined);
      setPlaying(!audio.paused);
      return;
    }
    audio.pause();
    setPlaying(false);
  }

  async function seek(nextSeconds: number, playAfterSeek = false) {
    const audio = audioRef.current;
    if (audio) {
      const duration = Number.isFinite(audio.duration) ? audio.duration : durationSeconds;
      audio.currentTime = Math.max(0, duration > 0 ? Math.min(nextSeconds, duration) : nextSeconds);
      if (playAfterSeek) {
        await audio.play().catch(() => undefined);
        setPlaying(!audio.paused);
      }
    }
    setCurrentSeconds(nextSeconds);
  }

  return props.state.mode === "completed" ? renderCompleted() : renderLive();

  function renderLive(): ReactNode {
    const active = props.state.mode === "recording" || props.state.mode === "paused" || props.state.mode === "transcribing";
    const liveLines = props.state.liveSegments ?? [];
    if (!active && props.state.mode !== "starting") {
      return (
        <div className="litrev-preview-empty legal-recording-preview__empty">
          <Mic size={28} aria-hidden="true" />
          <strong>{t("legalDiagnosis.recording.preview.empty")}</strong>
          <small>{t("legalDiagnosis.recording.preview.emptyDetail")}</small>
        </div>
      );
    }
    const statusKey = props.state.mode === "paused"
      ? "legalDiagnosis.recording.preview.paused"
      : props.state.mode === "transcribing"
        ? "legalDiagnosis.recording.preview.transcribing"
        : props.state.mode === "starting"
          ? "legalDiagnosis.recording.preview.starting"
          : "legalDiagnosis.recording.preview.recording";
    return (
      <div className="legal-recording-preview__live">
        <div className={`legal-recording-preview__live-status${props.state.mode === "recording" ? " legal-recording-preview__live-status--active" : ""}`}>
          <span aria-hidden="true" />
          <strong>{t(statusKey)}</strong>
          <time>{formatClock(props.state.elapsedSeconds)}</time>
        </div>
        <div className="legal-recording-preview__live-copy" aria-live="polite">
          {liveLines.length ? liveLines.map((segment, index) => (
            <p
              key={segment.sentenceId}
              className={index === liveLines.length - 1 && !segment.final ? "legal-recording-preview__live-current" : ""}
            >
              <time>{formatClock(segment.startMs / 1000)}</time>{segment.text || "…"}
            </p>
          )) : <p className="legal-recording-preview__live-current">{t("legalDiagnosis.recording.preview.waitingForSpeech")}</p>}
        </div>
        {props.state.realtimeError ? (
          <p className="legal-recording-preview__realtime-error" role="status">
            {t("legalDiagnosis.recording.preview.realtimeUnavailable")}
          </p>
        ) : null}
      </div>
    );
  }

  function renderCompleted(): ReactNode {
    return (
      <div className="legal-recording-preview__completed">
        <section className="legal-recording-player" aria-label={t("legalDiagnosis.recording.preview.player")}>
          <div className="legal-recording-player__timeline">
            <button type="button" aria-label={t(playing ? "legalDiagnosis.recording.preview.pause" : "legalDiagnosis.recording.preview.play")} disabled={!audioUrl} onClick={() => void togglePlayback()}>
              {playing ? <Pause size={16} /> : <Play size={17} />}
            </button>
            <time>{formatClock(currentSeconds)}</time>
            <input
              type="range"
              min={0}
              max={Math.max(durationSeconds, 1)}
              step={0.1}
              value={Math.min(currentSeconds, Math.max(durationSeconds, 1))}
              style={{ "--legal-recording-progress": `${progressPercent}%` } as CSSProperties}
              aria-label={t("legalDiagnosis.recording.preview.progress")}
              disabled={!audioUrl}
              onChange={(event) => void seek(Number(event.target.value))}
            />
            <time>{formatClock(durationSeconds)}</time>
          </div>
          <audio
            ref={audioRef}
            src={audioUrl || undefined}
            onLoadedMetadata={(event) => {
              const duration = event.currentTarget.duration;
              if (Number.isFinite(duration)) setMediaDuration(Math.round(duration));
            }}
            onTimeUpdate={(event) => setCurrentSeconds(event.currentTarget.currentTime)}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
            onEnded={() => setPlaying(false)}
          />
        </section>
        <div className="legal-recording-preview__tabs" role="tablist" aria-label={t("legalDiagnosis.recording.preview.tabs")}>
          <button type="button" role="tab" aria-selected="true">{t("legalDiagnosis.recording.preview.transcript")}</button>
        </div>
        <div className="legal-recording-transcript">
          {segments.length ? segments.map((segment) => (
            <article
              key={segment.id}
              className="legal-recording-transcript__segment"
              onClick={audioUrl ? () => void seek(segment.startMs / 1000, true) : undefined}
            >
              <header>
                <span data-speaker={segment.speakerNumber}>{segment.speakerNumber}</span>
                <strong>{segment.speaker}</strong>
                <button
                  type="button"
                  className="legal-recording-transcript__seek"
                  aria-label={`${t("legalDiagnosis.recording.preview.seekTo")} ${segment.time}`}
                  disabled={!audioUrl}
                  onClick={(event) => {
                    event.stopPropagation();
                    void seek(segment.startMs / 1000, true);
                  }}
                >
                  <time>{segment.time}</time>
                </button>
              </header>
              <p>{segment.text}</p>
            </article>
          )) : (
            <div className="litrev-preview-empty legal-recording-preview__transcript-empty">
              <strong>{t("legalDiagnosis.recording.preview.noTranscript")}</strong>
              <small>{t("legalDiagnosis.recording.preview.recordingKept")}</small>
            </div>
          )}
        </div>
      </div>
    );
  }
}

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function recordingDurationSeconds(state: LegalRecordingPreviewState): number {
  const durationMs = state.recording?.durationMs;
  return durationMs === undefined ? state.elapsedSeconds : Math.max(state.elapsedSeconds, Math.round(durationMs / 1000));
}

function recordingParticipantCount(state: LegalRecordingPreviewState): number | null {
  const speakers = new Set(resolveLegalTranscriptSegments(state.transcript, state.segments).map((segment) => segment.speakerNumber));
  return speakers.size ? speakers.size : null;
}

function recordingListStatus(state: LegalRecordingPreviewState, t: ReturnType<typeof useTranslation>["t"]): string {
  if (state.mode === "starting" || state.mode === "recording" || state.mode === "paused") {
    return t("legalDiagnosis.recording.library.statusRecording");
  }
  if (state.mode === "transcribing") return t("legalDiagnosis.recording.library.statusTranscribing");
  if (state.transcript.trim()) return t("legalDiagnosis.recording.library.statusReady");
  return t("legalDiagnosis.recording.library.statusPending");
}

function formatRecordingDate(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function recordingTimestamp(item: LegalRecordingViewItem): number {
  const value = recordingDateValue(item);
  return value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY;
}

function recordingDateValue(item: LegalRecordingViewItem): string | undefined {
  return validRecordingDate(item.state.recording?.recordedAt)
    ?? validRecordingDate(item.createdAt);
}

function validRecordingDate(value: string | undefined): string | undefined {
  return value && Number.isFinite(new Date(value).getTime()) ? value : undefined;
}

function parseTranscriptTime(value: string): number {
  const [minutes = "0", seconds = "0"] = value.split(":");
  return (Number(minutes) * 60 + Number(seconds)) * 1000;
}
