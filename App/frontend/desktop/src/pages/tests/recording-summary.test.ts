// @vitest-environment happy-dom

import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOCUSED_AGENT_CHAT_STORAGE_KEY } from "../../app/routes.js";
import { AGENT_FILE_TARGET_MAX_BYTES } from "../../lib/agent-attachment.js";
import { agentActions, appActions, type AppAction } from "../../state/app-actions.js";
import { appReducer, createInitialAppState } from "../../state/app-reducer.js";
import { agentChatScopeKey, type PendingFileAttachment } from "../../state/agent-composer-state.js";
import { submitAgentComposerMessage } from "../home-page.js";
import type { LegalRecordingPreviewMode, LegalRecordingViewItem } from "../labor-recording-preview-pane.js";
import { openRecordingSummaryDraft, prepareRecordingSummaryAttachment } from "../recording-summary.js";

const PROMPT = "请总结这段录音，提炼主要内容、关键结论和待办事项。";
const TRANSCRIPT = "发言人 1  00:00\n今天确认了下周的安排。";

function recording(overrides: Partial<LegalRecordingViewItem["state"]> = {}): LegalRecordingViewItem {
  return {
    id: "recording-summary",
    label: "团队例会",
    createdAt: "2026-09-07T01:00:00.000Z",
    state: { mode: "completed", elapsedSeconds: 60, transcript: TRANSCRIPT, transcriptSource: "asr", ...overrides }
  };
}

function oldAttachment(): PendingFileAttachment {
  const blob = new Blob(["已有材料"], { type: "text/plain" });
  return {
    id: "old-file", sourceKey: "old-file", fileName: "已有材料.txt", kind: "file", status: "ready",
    originalBytes: blob.size, uploadBlob: blob, uploadMime: "text/plain", uploadBytes: blob.size, extension: ".txt"
  };
}

function stateHarness() {
  let state = createInitialAppState();
  const dispatch = vi.fn((action: AppAction) => { state = appReducer(state, action); });
  return { dispatch, get state() { return state; } };
}

describe("recording summary drafts", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("prepares the complete transcript as a ready ordinary text attachment", async () => {
    const attachment = await prepareRecordingSummaryAttachment(recording());
    expect(attachment).toMatchObject({ fileName: "团队例会-转写.txt", kind: "file", status: "ready", uploadMime: "text/plain", extension: ".txt" });
    expect(await attachment!.uploadBlob!.text()).toBe(`${TRANSCRIPT}\n`);
    expect(attachment!.uploadBytes).toBe(new Blob([`${TRANSCRIPT}\n`]).size);
    expect(attachment!.sourceKey).toContain("content-metadata-v1");
  });

  it.each(["conversation", "blank draft"] as const)("opens an independent draft from an existing %s without changing its content or history", async (origin) => {
    const harness = stateHarness();
    harness.dispatch(agentActions.newChatCreated("chat-existing"));
    harness.dispatch(agentActions.userMessageQueued({ chatId: "chat-existing", content: "已有对话", clientRequestId: "request-existing" }));
    const existingHistory = harness.state.agent.messages;
    if (origin === "blank draft") harness.dispatch(agentActions.newChatRequested());
    const oldScope = agentChatScopeKey(harness.state.agent.currentChatId, harness.state.agent.newChatRequestId);
    const previousAttachment = oldAttachment();
    harness.dispatch(agentActions.composerDraftUpdated(oldScope, "还没写完的原草稿"));
    harness.dispatch(agentActions.composerPendingAttachmentsUpdated(oldScope, [previousAttachment]));
    harness.dispatch(agentActions.draftTargetUpdated(oldScope, { kind: "project", projectId: "old-project" }));
    harness.dispatch(appActions.navigate("/legal-diagnosis"));
    window.sessionStorage.setItem(FOCUSED_AGENT_CHAT_STORAGE_KEY, "chat-existing");
    harness.dispatch.mockClear();

    await expect(openRecordingSummaryDraft(recording(), PROMPT, harness.dispatch)).resolves.toBe(true);

    const next = harness.state.agent;
    const newScope = agentChatScopeKey(next.currentChatId, next.newChatRequestId);
    expect(newScope).not.toBe(oldScope);
    expect(next.currentChatId).toBeNull();
    expect(next.blankDraftActive).toBe(true);
    expect(next.composerDraftsByScope[newScope]).toBe(PROMPT);
    expect(next.composerPendingAttachmentsByScope[newScope]).toHaveLength(1);
    expect(next.composerPendingAttachmentsByScope[newScope]![0]).toMatchObject({ fileName: "团队例会-转写.txt", status: "ready" });
    expect(next.draftTargetsByScope[newScope]).toEqual({ kind: "standalone" });
    expect(next.composerDraftsByScope[oldScope]).toBe("还没写完的原草稿");
    expect(next.composerPendingAttachmentsByScope[oldScope]).toEqual([previousAttachment]);
    expect(next.draftTargetsByScope[oldScope]).toEqual({ kind: "project", projectId: "old-project" });
    expect(next.messagesByChatId["chat-existing"]).toEqual(existingHistory);
    expect(next.messages).toEqual([]);
    expect(next.isSending).toBe(false);
    expect(harness.state.navigation.currentPath).toBe("/main");
    expect(window.sessionStorage.getItem(FOCUSED_AGENT_CHAT_STORAGE_KEY)).toBeNull();
    expect(harness.dispatch.mock.calls.map(([action]) => action.type)).toEqual(["agent/newChatDraftPrepared", "navigation/changed"]);
  });

  it("keeps successive summaries in different scopes with their own attachments and prompts", async () => {
    const harness = stateHarness();
    await openRecordingSummaryDraft(recording(), PROMPT, harness.dispatch);
    const firstScope = agentChatScopeKey(null, harness.state.agent.newChatRequestId);
    const firstAttachment = harness.state.agent.composerPendingAttachmentsByScope[firstScope];
    await openRecordingSummaryDraft({ ...recording({ transcript: "另一份录音内容" }), id: "second-recording", label: "项目讨论" }, "总结这次讨论。", harness.dispatch);
    const secondScope = agentChatScopeKey(null, harness.state.agent.newChatRequestId);
    expect(secondScope).not.toBe(firstScope);
    expect(harness.state.agent.composerDraftsByScope[firstScope]).toBe(PROMPT);
    expect(harness.state.agent.composerPendingAttachmentsByScope[firstScope]).toBe(firstAttachment);
    expect(harness.state.agent.composerDraftsByScope[secondScope]).toBe("总结这次讨论。");
    expect(harness.state.agent.composerPendingAttachmentsByScope[secondScope]![0]).toMatchObject({ fileName: "项目讨论-转写.txt" });
  });

  it.each<LegalRecordingPreviewMode>(["idle", "starting", "recording", "paused", "transcribing"])("does not navigate or prepare a draft while the selected recording is %s", async (mode) => {
    const dispatch = vi.fn();
    window.sessionStorage.setItem(FOCUSED_AGENT_CHAT_STORAGE_KEY, "chat-existing");
    await expect(openRecordingSummaryDraft(recording({ mode }), PROMPT, dispatch)).resolves.toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(FOCUSED_AGENT_CHAT_STORAGE_KEY)).toBe("chat-existing");
  });

  it("does not navigate when a completed recording has no transcript", async () => {
    const dispatch = vi.fn();
    await expect(openRecordingSummaryDraft(recording({ transcript: " \n " }), PROMPT, dispatch)).resolves.toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects an oversized transcript before clearing focus or creating a draft", async () => {
    const dispatch = vi.fn();
    window.sessionStorage.setItem(FOCUSED_AGENT_CHAT_STORAGE_KEY, "chat-existing");
    await expect(openRecordingSummaryDraft(recording({ transcript: "a".repeat(AGENT_FILE_TARGET_MAX_BYTES) }), PROMPT, dispatch)).rejects.toThrow("home.media.error.fileTooLarge");
    expect(dispatch).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(FOCUSED_AGENT_CHAT_STORAGE_KEY)).toBe("chat-existing");
  });

  it("leaves focus and drafts untouched if reading the transcript file fails", async () => {
    const dispatch = vi.fn();
    vi.spyOn(File.prototype, "arrayBuffer").mockRejectedValue(new Error("cannot read file"));
    window.sessionStorage.setItem(FOCUSED_AGENT_CHAT_STORAGE_KEY, "chat-existing");
    await expect(openRecordingSummaryDraft(recording(), PROMPT, dispatch)).rejects.toThrow("home.media.error.sendReadFailed");
    expect(dispatch).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(FOCUSED_AGENT_CHAT_STORAGE_KEY)).toBe("chat-existing");
  });

  it("uses the ordinary new-chat, file-upload and Agent submission flow only when the user sends", async () => {
    const harness = stateHarness();
    const newChat = vi.fn(async () => ({ chatId: "chat-summary", modelPreset: "configured-model" }));
    const submitMessage = vi.fn(async () => ({ status: "accepted" as const }));
    const uploadedMedia = [{ path: "/media/transcript.txt", url: "http://agent.local/media/transcript", name: "团队例会-转写.txt", kind: "file" as const, mime: "text/plain" as const, bytes: 64 }];
    const uploadAgentMedia = vi.fn(async () => uploadedMedia);
    const clearComposer = vi.fn();

    await openRecordingSummaryDraft(recording(), PROMPT, harness.dispatch);
    expect(newChat).not.toHaveBeenCalled();
    expect(uploadAgentMedia).not.toHaveBeenCalled();
    expect(submitMessage).not.toHaveBeenCalled();
    const scope = agentChatScopeKey(null, harness.state.agent.newChatRequestId);
    const attachment = harness.state.agent.composerPendingAttachmentsByScope[scope]![0] as PendingFileAttachment;

    await expect(submitAgentComposerMessage({
      chatId: harness.state.agent.currentChatId,
      target: harness.state.agent.draftTargetsByScope[scope],
      scopeKey: scope,
      connection: { getReadyGeneration: () => 1, newChat, submitMessage },
      content: harness.state.agent.composerDraftsByScope[scope]!,
      pendingAttachments: harness.state.agent.composerPendingAttachmentsByScope[scope]!,
      uploadAgentMedia,
      dispatch: harness.dispatch,
      track: vi.fn(),
      clearComposer
    })).resolves.toBe(true);

    expect(newChat).toHaveBeenCalledTimes(1);
    expect(uploadAgentMedia).toHaveBeenCalledWith([{ blob: attachment.uploadBlob, name: "团队例会-转写.txt", kind: "file", mime: "text/plain" }]);
    expect(submitMessage).toHaveBeenCalledWith(expect.objectContaining({ chatId: "chat-summary", content: PROMPT, target: { kind: "standalone" }, media: uploadedMedia }), 1);
    expect(newChat.mock.invocationCallOrder[0]).toBeLessThan(uploadAgentMedia.mock.invocationCallOrder[0]!);
    expect(uploadAgentMedia.mock.invocationCallOrder[0]).toBeLessThan(submitMessage.mock.invocationCallOrder[0]!);
    expect(clearComposer).toHaveBeenCalledOnce();
  });
});
