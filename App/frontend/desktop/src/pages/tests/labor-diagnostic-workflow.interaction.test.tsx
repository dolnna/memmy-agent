// @vitest-environment happy-dom

import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import type { AsrRecorder, AsrRecorderStatus } from "../asr-recorder.js";
import type { LegalDiagPhase } from "../labor-diagnostic-model.js";
import type {
  LegalRecordingPreviewState,
  LegalStructuredTranscriptSegment
} from "../labor-recording-preview-pane.js";
import {
  LEGAL_DIAG_THINKING_INTERVAL_MS,
  LEGAL_DIAG_TODO_INTERVAL_MS,
  LaborDiagnosticWorkflow,
  formatStructuredTranscript,
  type LegalRecordingController
} from "../labor-diagnostic-workflow.js";
import type { SlashCommandPaletteItem } from "../agent-command-palette.js";
import {
  LEGAL_DIAG_TODO_ITEMS,
  LEGAL_DIAG_TODO_OUTPUTS
} from "../labor-diagnostic-demo-data.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function WorkflowHarness(props: {
  onPhase: (phase: LegalDiagPhase) => void;
  onRecorderCall?: (name: string) => void;
  onOpenArtifact?: (path: string) => void;
  onTranscriptReady?: (text: string) => void;
  onRecordingPreviewChange?: (state: LegalRecordingPreviewState) => void;
  finishError?: Error;
  uploadError?: Error;
  finishSegments?: LegalStructuredTranscriptSegment[];
  uploadSegments?: LegalStructuredTranscriptSegment[];
  controllerRef?: { current: LegalRecordingController | null };
}) {
  const [phase, setPhase] = useState<LegalDiagPhase>({ kind: "recording" });
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<AsrRecorderStatus>("idle");
  const recorder: AsrRecorder = {
    status,
    error: null,
    isRecording: status === "recording" || status === "paused",
    isTranscribing: status === "transcribing",
    isStarting: status === "checkingPermission" || status === "requestingPermission" || status === "starting",
    async start() {
      props.onRecorderCall?.("start");
      setStatus("recording");
    },
    pause() {
      props.onRecorderCall?.("pause");
      setStatus("paused");
    },
    resume() {
      props.onRecorderCall?.("resume");
      setStatus("recording");
    },
    cancel() {
      props.onRecorderCall?.("cancel");
      setStatus("idle");
    },
    async finishAndTranscribe() {
      props.onRecorderCall?.("finish");
      setStatus("transcribing");
      await Promise.resolve();
      setStatus("idle");
      if (props.finishError) throw props.finishError;
      return {
        text: "公司使用劳动合同用工，现场补充了工资与考勤情况。",
        modelId: "test-asr",
        provider: "test",
        source: "byok",
        transcribedAt: "2026-09-01T00:00:00.000Z",
        ...(props.finishSegments ? { segments: props.finishSegments } : {})
      };
    }
  };
  const slashCommands: SlashCommandPaletteItem[] = [{
    command: "/goal",
    title: "开始长期目标",
    description: "让 Agent 持续完成任务",
    icon: "sparkles",
    argHint: ""
  }];
  return (
    <LaborDiagnosticWorkflow
      prompt="上海某制造企业"
      phase={phase}
      onPhaseChange={(next) => {
        props.onPhase(next);
        setPhase(next);
      }}
      modelSelector={<button type="button" data-testid="legal-model-selector">测试模型</button>}
      slashCommands={slashCommands}
      recorder={recorder}
      composerRecorder={recorder}
      transcribeRecordingFile={async (file) => {
        props.onRecorderCall?.(`upload:${file.name}`);
        if (props.uploadError) throw props.uploadError;
        return {
          text: "上传录音显示，公司已提供合同模板和考勤记录。",
          modelId: "test-asr",
          provider: "test",
          source: "byok",
          transcribedAt: "2026-09-01T00:00:00.000Z",
          ...(props.uploadSegments ? { segments: props.uploadSegments } : {})
        };
      }}
      onTranscriptReady={(text) => props.onTranscriptReady?.(text)}
      onRecordingPreviewChange={props.onRecordingPreviewChange}
      recordingControllerRef={props.controllerRef}
      onOpenArtifact={props.onOpenArtifact}
      composerDraft={draft}
      onComposerDraftChange={setDraft}
      onComposerSubmit={() => undefined}
    />
  );
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

function setInputFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function structuredSegment(
  id: string,
  speakerId: number,
  startMs: number,
  text: string
): LegalStructuredTranscriptSegment {
  return {
    id,
    speakerId,
    startMs,
    endMs: startMs + 1_000,
    text,
    words: []
  };
}

describe("LaborDiagnosticWorkflow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let phase: LegalDiagPhase = { kind: "recording" };
  let recorderCalls: string[] = [];
  let openedArtifacts: string[] = [];

  beforeEach(async () => {
    vi.useFakeTimers();
    phase = { kind: "recording" };
    recorderCalls = [];
    openedArtifacts = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <WorkflowHarness
            onPhase={(next) => { phase = next; }}
            onRecorderCall={(name) => recorderCalls.push(name)}
            onOpenArtifact={(path) => openedArtifacts.push(path)}
          />
        </I18nProvider>
      );
    });
  });

  it("formats structured speaker segments for the transcript artifact", () => {
    expect(formatStructuredTranscript([
      structuredSegment("one", 0, 1_250, "第一段"),
      structuredSegment("two", 1, 65_000, "第二段")
    ])).toBe("发言人 1  00:01\n第一段\n\n发言人 2  01:05\n第二段");
  });

  it("uses the literature-review composer toolbar for attachments and voice input", async () => {
    expect(container.querySelector(".litrev-composer .composer-quick-actions")).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[aria-label="添加资料"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="legal-model-selector"]')?.textContent).toBe("测试模型");
    const capability = container.querySelector<HTMLButtonElement>('[aria-label="能力"]')!;
    expect(capability).not.toBeNull();
    await act(async () => capability.click());
    const goalCommand = container.querySelector<HTMLButtonElement>('[role="option"]')!;
    expect(goalCommand.textContent).toContain("/goal");
    await act(async () => goalCommand.click());
    expect(container.querySelector<HTMLTextAreaElement>(".litrev-composer textarea")?.value).toBe("/goal ");
    const voice = container.querySelector<HTMLButtonElement>('.litrev-composer [aria-label="语音输入"]')!;
    expect(voice.getAttribute("aria-pressed")).toBe("false");

    await act(async () => voice.click());
    expect(recorderCalls).toContain("start");
    expect(voice.getAttribute("aria-pressed")).toBe("true");

    await act(async () => voice.click());
    expect(recorderCalls).toContain("finish");
    expect(container.querySelector<HTMLTextAreaElement>(".litrev-composer textarea")?.value).toContain("公司使用劳动合同用工");
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("records, pauses, resumes, transcribes, and then opens the materials card", async () => {
    expect(container.querySelector(".legal-record-card")?.textContent).toContain("现场录音");
    expect(container.textContent).not.toContain("企业变量表");
    expect(recorderCalls).toEqual([]);

    await act(async () => buttonByText(container, "开始录音").click());
    await act(async () => buttonByText(container, "暂停").click());
    await act(async () => buttonByText(container, "继续").click());
    await act(async () => buttonByText(container, "结束并转写").click());

    expect(recorderCalls).toEqual(["start", "pause", "resume", "finish"]);
    expect(phase.kind).toBe("materials");
    expect(container.querySelector(".litrev-source-card")?.textContent).toContain("补充诊断材料");
    expect(container.textContent).toContain("现场录音已完成并生成转写");
    expect(container.querySelector(".legal-recording-completed.litrev-activity-history-item")).not.toBeNull();
    expect(container.querySelector(".legal-recording-completed.agent-activity-cluster")).toBeNull();
    expect(container.querySelector(".legal-recording-completed button")).toBeNull();
    expect(container.querySelector(".legal-recording-summary")).toBeNull();
  });

  it("keeps the central recording card and exposes the same recorder through the preview controller", async () => {
    const controllerRef: { current: LegalRecordingController | null } = { current: null };
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <WorkflowHarness
            onPhase={(next) => { phase = next; }}
            onRecorderCall={(name) => recorderCalls.push(name)}
            controllerRef={controllerRef}
          />
        </I18nProvider>
      );
    });

    expect(container.querySelector(".legal-record-card")).not.toBeNull();
    expect(controllerRef.current).not.toBeNull();
    await act(async () => controllerRef.current!.addConversationFile(new File(["转写正文"], "访谈转写.txt", { type: "text/plain" })));
    expect(container.querySelector(".legal-composer-context-chip")?.textContent).toContain("访谈转写.txt");
    await act(async () => controllerRef.current!.start());
    expect(recorderCalls).toEqual(["start"]);
    expect(phase.kind).toBe("recording");
    await act(async () => controllerRef.current!.skip());
    expect(phase.kind).toBe("materials");
  });

  it("uploads an existing recording and transcribes it before opening materials", async () => {
    const input = container.querySelector<HTMLInputElement>('input[accept^="audio/"]')!;
    await act(async () => {
      setInputFiles(input, [new File(["audio"], "已有访谈.m4a", { type: "audio/mp4" })]);
    });

    expect(recorderCalls).toEqual(["upload:已有访谈.m4a"]);
    expect(phase.kind).toBe("materials");
    expect(container.textContent).toContain("现场录音已完成并生成转写");
    expect(container.querySelector(".litrev-source-card")?.textContent).toContain("补充诊断材料");
  });

  it("keeps structured final segments from both microphone and uploaded recordings", async () => {
    const microphoneSegments = [structuredSegment("mic-1", 0, 1_250, "现场录音第一段")];
    const uploadSegments = [structuredSegment("upload-1", 1, 3_500, "上传录音第二段")];
    const previewStates: LegalRecordingPreviewState[] = [];
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <WorkflowHarness
            onPhase={(next) => { phase = next; }}
            onRecordingPreviewChange={(state) => previewStates.push(state)}
            finishSegments={microphoneSegments}
            uploadSegments={uploadSegments}
          />
        </I18nProvider>
      );
    });

    await act(async () => buttonByText(container, "开始录音").click());
    await act(async () => buttonByText(container, "结束并转写").click());
    expect(previewStates.at(-1)?.segments).toEqual(microphoneSegments);

    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(
        <I18nProvider language="zh-CN">
          <WorkflowHarness
            onPhase={(next) => { phase = next; }}
            onRecordingPreviewChange={(state) => previewStates.push(state)}
            uploadSegments={uploadSegments}
          />
        </I18nProvider>
      );
    });
    const input = container.querySelector<HTMLInputElement>('input[accept^="audio/"]')!;
    await act(async () => {
      setInputFiles(input, [new File(["audio"], "已有访谈.wav", { type: "audio/wav" })]);
    });
    expect(previewStates.at(-1)?.segments).toEqual(uploadSegments);
  });

  it("keeps the task on recording and surfaces the real upstream error when final transcription fails", async () => {
    const transcripts: string[] = [];
    const previewStates: LegalRecordingPreviewState[] = [];
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <WorkflowHarness
            onPhase={(next) => { phase = next; }}
            onRecorderCall={(name) => recorderCalls.push(name)}
            onTranscriptReady={(text) => transcripts.push(text)}
            onRecordingPreviewChange={(state) => previewStates.push(state)}
            finishError={new Error("ASR upstream request failed")}
          />
        </I18nProvider>
      );
    });

    await act(async () => buttonByText(container, "开始录音").click());
    await act(async () => buttonByText(container, "结束并转写").click());

    expect(phase.kind).toBe("recording");
    expect(transcripts).toEqual([]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("ASR upstream request failed");
    expect(previewStates.at(-1)).toMatchObject({
      mode: "completed",
      transcript: "",
      transcriptSource: null
    });
  });

  it("does not fabricate a transcript when an uploaded recording cannot be transcribed", async () => {
    const transcripts: string[] = [];
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <WorkflowHarness
            onPhase={(next) => { phase = next; }}
            onRecorderCall={(name) => recorderCalls.push(name)}
            onTranscriptReady={(text) => transcripts.push(text)}
            uploadError={new Error("ASR upstream request failed")}
          />
        </I18nProvider>
      );
    });

    const input = container.querySelector<HTMLInputElement>('input[accept^="audio/"]')!;
    await act(async () => {
      setInputFiles(input, [new File(["audio"], "失败录音.m4a", { type: "audio/mp4" })]);
    });

    expect(phase.kind).toBe("recording");
    expect(transcripts).toEqual([]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("ASR upstream request failed");
  });

  it("does not hide non-upstream recording errors behind demo data", async () => {
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <WorkflowHarness
            onPhase={(next) => { phase = next; }}
            finishError={new Error("录音编码失败")}
          />
        </I18nProvider>
      );
    });

    await act(async () => buttonByText(container, "开始录音").click());
    await act(async () => buttonByText(container, "结束并转写").click());

    expect(phase.kind).toBe("recording");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("录音编码失败");
  });

  it("accepts company documents, lawyer worksheets, and scanned images", async () => {
    await act(async () => buttonByText(container, "跳过录音，直接补材料").click());
    expect(container.querySelector(".legal-recording-skipped.litrev-activity-history-item")?.textContent).toContain("已跳过现场录音");
    expect(container.querySelector(".legal-recording-skipped.agent-activity-cluster")).toBeNull();
    const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')];
    await act(async () => {
      setInputFiles(inputs[0]!, [
        new File(["license"], "营业执照.png", { type: "image/png" }),
        new File(["contract"], "劳动合同模板.docx"),
        new File(["worksheet"], "律师记录.xlsx")
      ]);
    });

    expect(container.textContent).toContain("营业执照.png");
    expect(container.textContent).toContain("劳动合同模板.docx");
    expect(container.textContent).toContain("律师记录.xlsx");

    await act(async () => buttonByText(container, "交给 AI 生成诊断结果").click());
    expect(phase.kind).toBe("thinking");
  });

  it("uses the literature-review task activity, file cards, and supplemental follow-up pattern", async () => {
    await act(async () => buttonByText(container, "跳过录音，直接补材料").click());
    await act(async () => buttonByText(container, "暂不补充，按录音继续").click());
    expect(phase.kind).toBe("thinking");
    expect(container.textContent).toContain("整理录音转写和补充材料");
    expect(container.querySelector(".legal-materials-summary--skipped")?.textContent).toContain("未补充诊断材料");
    expect(container.querySelector(".legal-intake-activity.agent-activity-cluster--running")?.getAttribute("class")).toContain("agent-activity-cluster--open");
    expect(container.querySelector(".litrev-stage-thinking-copy")).toBeNull();

    for (let index = 0; index < 10 && phase.kind !== "task"; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LEGAL_DIAG_THINKING_INTERVAL_MS);
      });
    }

    expect(phase.kind).toBe("task");
    expect(container.querySelector(".legal-intake-activity.agent-activity-cluster--running")).toBeNull();
    expect(container.querySelector(".legal-intake-activity .litrev-status-toggle")?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".agent-activity-cluster--running")).not.toBeNull();
    expect(container.querySelector(".litrev-spin")).not.toBeNull();
    expect(container.textContent).toContain("执行中");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEGAL_DIAG_TODO_INTERVAL_MS);
    });
    expect(container.textContent).toContain(LEGAL_DIAG_TODO_OUTPUTS[0]);

    for (let index = 0; index < 10 && !container.querySelector(".legal-missing-info-card"); index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LEGAL_DIAG_TODO_INTERVAL_MS);
      });
    }

    expect(phase.kind).toBe("task");
    expect(container.querySelector(".legal-missing-info-card")).not.toBeNull();
    expect(container.querySelector(".litrev-file-cards")).toBeNull();
    expect(container.textContent).toContain("诊断底稿已完成，还有 2 项信息会影响后续判定");
    const confirmMissingInfo = buttonByText(container, "确认并更新诊断");
    expect(confirmMissingInfo.disabled).toBe(true);
    await act(async () => buttonByText(container, "电子打卡").click());
    await act(async () => buttonByText(container, "没有").click());
    expect(confirmMissingInfo.disabled).toBe(false);
    expect(buttonByText(container, "电子打卡").getAttribute("aria-checked")).toBe("true");
    await act(async () => confirmMissingInfo.click());

    expect(phase.kind).toBe("task");
    expect(container.querySelector(".legal-missing-info-card")).toBeNull();
    expect(container.textContent).toContain("现在继续生成正式报告");

    for (let index = 0; index < 10 && phase.kind !== "review"; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LEGAL_DIAG_TODO_INTERVAL_MS);
      });
    }

    expect(phase.kind).toBe("review");
    const processToggle = container.querySelector<HTMLButtonElement>(".litrev-task-process .litrev-status-toggle")!;
    expect(processToggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".litrev-todo__list")).toBeNull();
    expect(container.textContent).toContain("用工合规及风险诊断表.xlsx");
    expect(container.textContent).toContain("用工风险与合规诊断报告.docx");
    expect(container.querySelectorAll("button.litrev-file-card")).toHaveLength(3);
    expect(container.querySelector(".legal-result-files")).toBeNull();
    expect(container.querySelector(".litrev-missing-info")).toBeNull();
    expect(container.textContent).toContain("加班记录采用哪种保存方式？ 电子打卡");
    const resultCards = container.querySelector(".litrev-file-cards")!;
    const missingInfoSupplement = [...container.querySelectorAll<HTMLElement>(".litrev-supplement")]
      .find((item) => item.textContent?.includes("加班记录采用哪种保存方式？"))!;
    expect(missingInfoSupplement.compareDocumentPosition(resultCards) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    await act(async () => buttonByText(container, "用工风险与合规诊断报告.docx").click());
    expect(openedArtifacts).toEqual(["reports/用工风险与合规诊断报告.docx"]);

    const composer = container.querySelector<HTMLTextAreaElement>(".litrev-composer textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        composer,
        "加班记录使用电子打卡保存"
      );
      composer.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!;
    expect(send.disabled).toBe(false);
    await act(async () => send.click());
    const supplement = [...container.querySelectorAll<HTMLElement>(".litrev-supplement")].at(-1)!;
    expect(resultCards.compareDocumentPosition(supplement) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(supplement.textContent).toContain("加班记录使用电子打卡保存");

    await act(async () => processToggle.click());
    expect(processToggle.getAttribute("aria-expanded")).toBe("true");
    const completedTasksToggle = container.querySelector<HTMLButtonElement>(".litrev-task-process__body .litrev-stage-activity .litrev-status-toggle")!;
    expect(completedTasksToggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => completedTasksToggle.click());
    expect(container.querySelector(".litrev-todo__list")).not.toBeNull();
    expect(container.textContent).toContain("151 项用工诊断与 12 项税务专项");
    expect(LEGAL_DIAG_TODO_ITEMS).toHaveLength(5);
  });

  it("can skip the pre-report missing-information card and keeps the items pending", async () => {
    await act(async () => buttonByText(container, "跳过录音，直接补材料").click());
    await act(async () => buttonByText(container, "暂不补充，按录音继续").click());

    for (let index = 0; index < 10 && phase.kind !== "task"; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LEGAL_DIAG_THINKING_INTERVAL_MS);
      });
    }
    for (let index = 0; index < 10 && !container.querySelector(".legal-missing-info-card"); index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LEGAL_DIAG_TODO_INTERVAL_MS);
      });
    }

    expect(container.querySelector(".legal-missing-info-card")).not.toBeNull();
    expect(container.querySelector(".litrev-file-cards")).toBeNull();
    await act(async () => buttonByText(container, "暂不补充").click());
    expect(container.querySelector(".legal-missing-info-card")).toBeNull();

    for (let index = 0; index < 10 && phase.kind !== "review"; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LEGAL_DIAG_TODO_INTERVAL_MS);
      });
    }

    expect(phase.kind).toBe("review");
    expect(container.querySelectorAll("button.litrev-file-card")).toHaveLength(3);
    expect(container.textContent).toContain("正式报告已将相关项目保留为待核实");
  });
});
