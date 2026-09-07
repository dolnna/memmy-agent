import { useCallback, useRef, useState, type Dispatch } from "react";
import { clearFocusedAgentTarget } from "../app/routes.js";
import { useTranslation } from "../i18n/use-translation.js";
import { AGENT_FILE_TARGET_MAX_BYTES, agentAttachmentSourceKey, classifyAgentAttachmentFile, hashAgentAttachmentFile } from "../lib/agent-attachment.js";
import { agentActions, appActions, type AppAction } from "../state/app-actions.js";
import type { PendingFileAttachment } from "../state/agent-composer-state.js";
import { useAppState } from "../state/app-state.js";
import { recordingTranscriptSourceFile, type LegalRecordingViewItem } from "./labor-recording-preview-pane.js";

/** Validate the transcript before leaving its recording or changing any draft. */
export async function prepareRecordingSummaryAttachment(item: LegalRecordingViewItem): Promise<PendingFileAttachment | null> {
  const file = recordingTranscriptSourceFile(item);
  if (!file) return null;
  if (file.size > AGENT_FILE_TARGET_MAX_BYTES) throw new Error("home.media.error.fileTooLarge");
  const classification = classifyAgentAttachmentFile(file);
  if (!classification) throw new Error("home.media.error.sendReadFailed");
  return {
    id: crypto.randomUUID(),
    sourceKey: agentAttachmentSourceKey(file, classification, await hashAgentAttachmentFile(file)),
    fileName: file.name,
    kind: "file",
    status: "ready",
    originalBytes: file.size,
    uploadBlob: file,
    uploadMime: "text/plain",
    uploadBytes: file.size,
    extension: ".txt"
  };
}

/** Stage a fresh ordinary chat; the existing send flow creates/runs the Agent only on Send. */
export async function openRecordingSummaryDraft(item: LegalRecordingViewItem, prompt: string, dispatch: Dispatch<AppAction>): Promise<boolean> {
  const attachment = await prepareRecordingSummaryAttachment(item);
  if (!attachment) return false;
  if (typeof window !== "undefined") {
    clearFocusedAgentTarget(window.sessionStorage, window.location, window.history);
  }
  dispatch(agentActions.newChatDraftPrepared(prompt, [attachment], { kind: "standalone" }));
  dispatch(appActions.navigate("/main"));
  return true;
}

export function useRecordingSummary() {
  const { dispatch } = useAppState();
  const { t } = useTranslation();
  const preparingRef = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const summarize = useCallback(async (item: LegalRecordingViewItem) => {
    if (preparingRef.current) return;
    preparingRef.current = true;
    setPreparing(true);
    setError("");
    try {
      await openRecordingSummaryDraft(item, t("legalDiagnosis.recording.summaryPrompt"), dispatch);
    } catch (cause) {
      setError(t(cause instanceof Error && cause.message === "home.media.error.fileTooLarge"
        ? "home.media.error.fileTooLarge" : "home.media.error.sendReadFailed"));
    } finally {
      preparingRef.current = false;
      setPreparing(false);
    }
  }, [dispatch, t]);
  return { summarize, preparing, error };
}
