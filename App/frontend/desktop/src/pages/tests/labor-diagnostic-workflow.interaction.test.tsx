// @vitest-environment happy-dom

import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import type { AsrRecorder, AsrRecorderStatus } from "../asr-recorder.js";
import type { LegalDiagPhase } from "../labor-diagnostic-model.js";
import type { LegalDiagSourceItem } from "../labor-diagnostic-workspace.js";
import type {
  LegalRecordingPreviewState,
  LegalStructuredTranscriptSegment
} from "../labor-recording-preview-pane.js";
import {
  LEGAL_DIAG_TODO_INTERVAL_MS,
  LaborDiagnosticWorkflow,
  formatStructuredTranscript,
  type LegalRecordingController
} from "../labor-diagnostic-workflow.js";
import type { SlashCommandPaletteItem } from "../agent-command-palette.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function WorkflowHarness(props: {
  onPhase: (phase: LegalDiagPhase) => void;
  onRecorderCall?: (name: string) => void;
  onOpenArtifact?: (path: string) => void;
  onOpenRecording?: () => void;
  onTranscriptReady?: (text: string) => void;
  onSources?: (items: LegalDiagSourceItem[]) => void;
  onRecordingPreviewChange?: (state: LegalRecordingPreviewState) => void;
  finishError?: Error;
  uploadError?: Error;
  finishSegments?: LegalStructuredTranscriptSegment[];
  uploadSegments?: LegalStructuredTranscriptSegment[];
  controllerRef?: { current: LegalRecordingController | null };
}) {
  const [phase, setPhase] = useState<LegalDiagPhase>({ kind: "collecting" });
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
      onSourcesChange={props.onSources}
      onTranscriptReady={(text) => props.onTranscriptReady?.(text)}
      onRecordingPreviewChange={props.onRecordingPreviewChange}
      onOpenRecording={props.onOpenRecording}
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
  let phase: LegalDiagPhase = { kind: "collecting" };
  let recorderCalls: string[] = [];
  let openedArtifacts: string[] = [];

  beforeEach(async () => {
    vi.useFakeTimers();
    phase = { kind: "collecting" };
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
    await act(async () => shortcut(container, "访谈录音").click());
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

  it("records, pauses, resumes, and transcribes from the compact recording strip", async () => {
    expect(container.querySelector(".legal-record-card")?.textContent).toContain("访谈录音");
    expect(container.textContent).not.toContain("企业变量表");
    expect(recorderCalls).toEqual([]);

    await act(async () => buttonByText(container, "开始录音").click());
    await act(async () => buttonByText(container, "暂停").click());
    await act(async () => buttonByText(container, "继续").click());
    await act(async () => buttonByText(container, "结束并转写").click());

    expect(recorderCalls).toEqual(["start", "pause", "resume", "finish"]);
    expect(phase.kind).toBe("collecting");
    expect(container.querySelector(".legal-record-card")).toBeNull();
    expect(container.querySelector(".litrev-source-card")?.textContent).toContain("访谈转写.txt");
    expect(container.querySelector(".litrev-source-card")?.textContent).toContain("生成 AI 诊断报告");
    expect(container.querySelector(".legal-generate-report")).toBeNull();
    expect(container.querySelector(".legal-composer-contexts")).toBeNull();
    await act(async () => buttonByText(container, "访谈转写.txt").click());
    expect(openedArtifacts).toEqual(["materials/访谈转写.txt"]);
    expect(container.textContent).toContain("现场录音已完成并生成转写");
    expect(container.querySelector(".legal-recording-completed.litrev-activity-history-item")).not.toBeNull();
    expect(container.querySelector(".legal-recording-completed.agent-activity-cluster")).toBeNull();
    expect(container.querySelector(".legal-recording-completed button")).toBeNull();
    expect(container.querySelector(".legal-recording-summary")).toBeNull();
  });

  it("retains existing materials and creates a separate transcript file for each completed interview", async () => {
    let sources: LegalDiagSourceItem[] = [];
    await act(async () => root.render(
      <I18nProvider language="zh-CN"><WorkflowHarness
        onPhase={(next) => { phase = next; }}
        onSources={(items) => { sources = items; }}
      /></I18nProvider>
    ));
    const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    await act(async () => setInputFiles(input, [new File(["company details"], "企业信息.txt")]));
    await act(async () => buttonByText(container, "开始录音").click());
    await act(async () => buttonByText(container, "结束并转写").click());
    expect(sources.map((item) => item.label)).toEqual(["企业信息.txt", "访谈转写.txt"]);
    expect(await sources[1]!.file.text()).toContain("公司使用劳动合同用工，现场补充了工资与考勤情况。");
    await act(async () => container.querySelector<HTMLButtonElement>('.litrev-source-card [aria-label="收起卡片"]')!.click());
    await act(async () => shortcut(container, "访谈录音").click());
    await act(async () => buttonByText(container, "开始录音").click());
    await act(async () => buttonByText(container, "结束并转写").click());
    expect(sources.map((item) => item.label)).toEqual(["企业信息.txt", "访谈转写.txt", "访谈转写-2.txt"]);
    expect(container.querySelector(".litrev-source-card")?.textContent).toContain("访谈转写-2.txt");
    expect(phase.kind).toBe("collecting");
  });

  it("finishes the interview workflow with only the original audio, transcript, and Word report", async () => {
    await act(async () => buttonByText(container, "开始录音").click());
    await act(async () => buttonByText(container, "结束并转写").click());
    await act(async () => buttonByText(container, "生成 AI 诊断报告").click());
    for (let i = 0; i < 15 && !container.querySelector(".legal-missing-info-card"); i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(LEGAL_DIAG_TODO_INTERVAL_MS); });
    }
    expect(container.querySelector(".litrev-file-cards")).toBeNull();
    await act(async () => buttonByText(container, "暂不补充").click());
    for (let i = 0; i < 15 && phase.kind !== "review"; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(LEGAL_DIAG_TODO_INTERVAL_MS); });
    }
    expect(phase.kind).toBe("review");
    const names = [...container.querySelectorAll(".litrev-file-card__text strong")].map((node) => node.textContent);
    expect(names).toEqual(["访谈录音.m4a", "访谈转写.txt", "用工风险诊断报告.docx"]);
    await act(async () => buttonByText(container, "用工风险诊断报告.docx").click());
    expect(openedArtifacts).toEqual(["reports/用工风险诊断报告.docx"]);
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
    expect(phase.kind).toBe("collecting");
    expect(container.querySelector(".legal-generate-report")).toBeNull();
    expect(container.querySelector(".legal-workflow-actions")?.textContent).not.toContain("生成 AI 诊断报告");
    await act(async () => controllerRef.current!.pause());
    expect(container.querySelector(".legal-record-card")?.textContent).toContain("录音已暂停");
    expect(container.querySelector(".legal-generate-report")).toBeNull();
  });

  it("collects existing recordings through materials without a separate recording upload entry", async () => {
    expect(container.querySelector('input[accept^="audio/"]')).toBeNull();
    expect(container.querySelector(".legal-record-card")?.textContent).not.toContain("上传录音");
    await act(async () => openAttachments(container));
    const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    await act(async () => setInputFiles(input, [new File(["audio"], "已有访谈.m4a", { type: "audio/mp4" })]));
    await act(async () => shortcut(container, "访谈录音").click());
    await act(async () => openAttachments(container));
    expect(container.querySelector(".legal-composer-contexts")?.textContent).toContain("已有访谈.m4a");
    expect(phase.kind).toBe("collecting");
  });

  it("keeps structured final segments from both microphone and uploaded recordings", async () => {
    const controllerRef: { current: LegalRecordingController | null } = { current: null };
    const microphoneSegments = [structuredSegment("mic-1", 0, 1_250, "现场录音第一段")];
    const uploadSegments = [structuredSegment("upload-1", 1, 3_500, "上传录音第二段")];
    const previewStates: LegalRecordingPreviewState[] = [];
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <WorkflowHarness
            controllerRef={controllerRef}
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
            controllerRef={controllerRef}
            onPhase={(next) => { phase = next; }}
            onRecordingPreviewChange={(state) => previewStates.push(state)}
            uploadSegments={uploadSegments}
          />
        </I18nProvider>
      );
    });
    await act(async () => shortcut(container, "访谈录音").click());
    await act(async () => {
      await controllerRef.current!.upload(new File(["audio"], "已有访谈.wav", { type: "audio/wav" }));
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

    expect(phase.kind).toBe("collecting");
    expect(transcripts).toEqual([]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("ASR upstream request failed");
    expect(previewStates.at(-1)).toMatchObject({
      mode: "completed",
      transcript: "",
      transcriptSource: null
    });
  });

  it("does not fabricate a transcript when an uploaded recording cannot be transcribed", async () => {
    const controllerRef: { current: LegalRecordingController | null } = { current: null };
    const transcripts: string[] = [];
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <WorkflowHarness
            controllerRef={controllerRef}
            onPhase={(next) => { phase = next; }}
            onRecorderCall={(name) => recorderCalls.push(name)}
            onTranscriptReady={(text) => transcripts.push(text)}
            uploadError={new Error("ASR upstream request failed")}
          />
        </I18nProvider>
      );
    });

    await act(async () => {
      await controllerRef.current!.upload(new File(["audio"], "失败录音.m4a", { type: "audio/mp4" }));
    });

    expect(phase.kind).toBe("collecting");
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

    expect(phase.kind).toBe("collecting");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("录音编码失败");
  });

  it("accepts company documents, lawyer worksheets, and scanned images", async () => {
    await act(async () => openAttachments(container));
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

    await sendText(container, "生成诊断报告");
    expect(phase.kind).toBe("thinking");
  });

  it("opens file selection from the full upload area and keeps file preview separate from removal", async () => {
    await sendText(container, "我要上传资料");
    const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    const pickFiles = vi.spyOn(input, "click").mockImplementation(() => undefined);
    await act(async () => container.querySelector<HTMLButtonElement>(".legal-materials-dropzone")!.click());
    expect(pickFiles).toHaveBeenCalledOnce();
    await act(async () => setInputFiles(input, [new File(["notes"], "访谈纪要.txt")]));
    await act(async () => container.querySelector<HTMLElement>(".legal-material-file .file-type-icon")!.click());
    expect(openedArtifacts).toEqual(["materials/访谈纪要.txt"]);
    await act(async () => container.querySelector<HTMLButtonElement>(".legal-material-remove")!.click());
    expect(container.querySelector(".legal-materials-dropzone")).not.toBeNull();
    expect(openedArtifacts).toEqual(["materials/访谈纪要.txt"]);
  });

  it("starts with two downloadable templates and allows either collection path", async () => {
    await act(async () => { root.unmount(); root = createRoot(container); root.render(<I18nProvider language="zh-CN"><WorkflowHarness onPhase={(next) => { phase = next; }} /></I18nProvider>); });
    expect(container.querySelector(".legal-template-card")).not.toBeNull();
    const downloads = [...container.querySelectorAll<HTMLAnchorElement>("a[download]")];
    expect(downloads.map((a) => a.download)).toEqual(["调研前准备清单.xlsx", "调研诊断模版.xlsx"]);
    expect(downloads.every((a) => a.href.includes(".xlsx"))).toBe(true);
    await act(async () => buttonByText(container, "已完成调研，上传资料").click());
    expect(container.querySelector<HTMLDetailsElement>(".agent-composer-attach-menu")?.open).toBe(false);
    expect(container.querySelector(".litrev-source-card")).not.toBeNull();
    expect(container.querySelector(".legal-template-card")).toBeNull();
    expect(container.querySelector(".legal-workflow-actions")).toBeNull();
    expect(phase.kind).toBe("collecting");
    await act(async () => container.querySelector<HTMLButtonElement>('.litrev-source-card [aria-label="收起卡片"]')!.click());
    await act(async () => shortcut(container, "诊断指引").click());
    await act(async () => buttonByText(container, "我在现场，要录音").click());
    expect(container.querySelector(".legal-record-card")).not.toBeNull();
  });

  it("preserves recordings and files when cards are changed or dismissed", async () => {
    await act(async () => buttonByText(container, "开始录音").click());
    await act(async () => shortcut(container, "诊断指引").click());
    expect(container.querySelector(".legal-recording-indicator")?.textContent).toContain("正在录音");
    await act(async () => openAttachments(container));
    const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    await act(async () => setInputFiles(input, [new File(["facts"], "企业预填信息.xlsx")]));
    await act(async () => container.querySelector<HTMLButtonElement>('.legal-template-card [aria-label="收起卡片"]')!.click());
    expect(recorderCalls).toEqual(["start"]);
    await act(async () => openAttachments(container));
    expect(container.textContent).toContain("企业预填信息.xlsx");
    expect(container.querySelector(".legal-generate-report")).toBeNull();
    await act(async () => shortcut(container, "访谈录音").click());
    await act(async () => buttonByText(container, "暂停").click());
    await act(async () => container.querySelector<HTMLButtonElement>('.legal-record-card [aria-label="收起卡片"]')!.click());
    expect(container.querySelector(".legal-recording-indicator")?.textContent).toContain("录音已暂停");
    expect(recorderCalls).toEqual(["start", "pause"]);
    expect(phase.kind).toBe("collecting");
  });

  it("keeps materials in front of recording controls without stopping recording or losing files", async () => {
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
    await act(async () => controllerRef.current!.start());
    await act(async () => shortcut(container, "诊断指引").click());
    await act(async () => buttonByText(container, "已完成调研，上传资料").click());
    const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    await act(async () => setInputFiles(input, [new File(["facts"], "访谈资料.txt")]));
    await act(async () => controllerRef.current!.open());
    expect(container.querySelector(".litrev-source-card")?.textContent).toContain("访谈资料.txt");
    expect(container.querySelector(".legal-template-card")).toBeNull();
    expect(container.querySelector(".legal-record-card")).toBeNull();
    expect(container.querySelector(".legal-recording-indicator")).toBeNull();
    expect(container.querySelector(".legal-workflow-actions")).toBeNull();
    expect(recorderCalls).toEqual(["start"]);

    await act(async () => controllerRef.current!.pause());
    await act(async () => container.querySelector<HTMLButtonElement>('.litrev-source-card [aria-label="收起卡片"]')!.click());
    expect(container.querySelector(".legal-workflow-actions")).not.toBeNull();
    expect(container.querySelector(".legal-recording-indicator")?.textContent).toContain("录音已暂停");
    await sendText(container, "上传资料");
    expect(container.querySelector(".litrev-source-card")?.textContent).toContain("访谈资料.txt");
    expect(recorderCalls).toEqual(["start", "pause"]);
  });

  it("keeps attachments while recording and accepts more files after transcription", async () => {
    await act(async () => openAttachments(container));
    const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    await act(async () => setInputFiles(input, [new File(["company"], "企业预填信息.xlsx")]));
    await act(async () => buttonByText(container, "开始录音").click());
    await act(async () => shortcut(container, "诊断指引").click());
    expect(container.querySelector(".legal-recording-indicator")).not.toBeNull();
    expect(container.querySelector(".legal-composer-contexts")?.textContent).toContain("企业预填信息.xlsx");
    expect(container.querySelector(".legal-generate-report")).toBeNull();
    await act(async () => shortcut(container, "访谈录音").click());
    expect(recorderCalls).toEqual(["start"]);
    await act(async () => buttonByText(container, "结束并转写").click());
    await act(async () => setInputFiles(input, [new File(["notes"], "补充访谈纪要.txt")]));
    expect(container.querySelectorAll(".legal-composer-context-chip")).toHaveLength(2);
    expect(buttonByText(container, "生成 AI 诊断报告").disabled).toBe(false);
    expect(recorderCalls).toEqual(["start", "finish"]);
    expect(phase.kind).toBe("collecting");
  });

  it("routes explicit requests and accepts facts without starting recording or report generation", async () => {
    await sendText(container, "我要模板");
    expect(container.querySelector(".legal-template-card")).not.toBeNull();
    await sendText(container, "我要录音");
    expect(container.querySelector(".legal-record-card")).not.toBeNull();
    expect(recorderCalls).toEqual([]);
    await sendText(container, "我要补充一些信息，这家公司有三个经营主体");
    expect(container.querySelector(".legal-active-card")?.textContent).toBe("");
    expect(container.textContent).toContain("这家公司有三个经营主体");
    expect(phase.kind).toBe("collecting");
    await sendText(container, "我要上传资料");
    expect(container.querySelector<HTMLDetailsElement>(".agent-composer-attach-menu")?.open).toBe(false);
    expect(container.querySelector(".litrev-source-card")).not.toBeNull();
    await sendText(container, "先跳过");
    expect(phase.kind).toBe("collecting");
    await sendText(container, "生成诊断报告");
    expect(phase.kind).toBe("thinking");
  });

  it("opens the materials card when report generation has no sources", async () => {
    await sendText(container, "生成诊断报告");
    expect(phase.kind).toBe("collecting");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("请先添加已有资料");
    expect(container.querySelector<HTMLDetailsElement>(".agent-composer-attach-menu")?.open).toBe(false);
    expect(container.querySelector(".litrev-source-card")).not.toBeNull();
    expect(container.querySelector(".legal-generate-report")).toBeNull();
  });

  it("sends attachments without text and retains previewable files for explicit report generation", async () => {
    await act(async () => openAttachments(container));
    const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    await act(async () => setInputFiles(input, [new File(["interview"], "访谈记录.txt"), new File(["audio"], "录音.m4a")]));
    const send = container.querySelector<HTMLButtonElement>('[aria-label="发送"]')!;
    expect(send.disabled).toBe(false);
    await act(async () => send.click());
    expect(container.querySelector(".legal-composer-contexts")).toBeNull();
    expect(container.querySelectorAll(".legal-message-file")).toHaveLength(2);
    expect(phase.kind).toBe("collecting");
    await act(async () => buttonByText(container, "访谈记录.txt").click());
    expect(openedArtifacts).toEqual(["materials/访谈记录.txt"]);
    await sendText(container, "生成诊断报告");
    expect(phase.kind).toBe("thinking");
  });

  it("removes unsent attachments from the task but retains a previously sent copy", async () => {
    const file = new File(["interview"], "访谈记录.txt");
    const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    await act(async () => setInputFiles(input, [file]));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="移除: 访谈记录.txt"], [aria-label="删除: 访谈记录.txt"], .legal-composer-context-chip button')!.click());
    expect(container.querySelector(".legal-generate-report")).toBeNull();
    await act(async () => setInputFiles(input, [file]));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="发送"]')!.click());
    await act(async () => setInputFiles(input, [file]));
    await act(async () => container.querySelector<HTMLButtonElement>('.legal-composer-context-chip button')!.click());
    expect(container.querySelector(".legal-composer-contexts")).toBeNull();
    expect(container.querySelectorAll(".legal-message-file")).toHaveLength(1);
    expect(container.querySelector(".legal-generate-report")).toBeNull();
    await sendText(container, "生成诊断报告");
    expect(phase.kind).toBe("thinking");
  });

  it("pauses at the verification TODO and generates the report only after confirmation", async () => {
    await sendText(container, "企业目前使用电子考勤");
    await sendText(container, "生成诊断报告");
    expect(phase.kind).toBe("thinking");
    expect(container.querySelector(".legal-missing-info-card")).toBeNull();
    for (let i = 0; i < 15 && !container.querySelector(".legal-missing-info-card"); i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(LEGAL_DIAG_TODO_INTERVAL_MS); });
    }
    expect(phase.kind).toBe("task");
    expect(container.querySelector(".litrev-todo__item--current")?.textContent).toContain("核实关键信息");
    expect(container.querySelector(".litrev-todo__item--current")?.textContent).toContain("待确认");
    expect(container.querySelectorAll(".litrev-todo__item--done")).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(phase.kind).toBe("task");
    expect(container.querySelectorAll(".litrev-todo__item--done")).toHaveLength(2);
    expect(container.querySelector(".litrev-file-cards")).toBeNull();
    expect(container.querySelector(".legal-workflow-actions")).toBeNull();
    expect(container.querySelector(".legal-chat-composer")).not.toBeNull();
    expect(container.querySelectorAll(".legal-missing-info-card .litrev-question-card__foot button")).toHaveLength(1);
    await sendText(container, "另外补充，企业有多个办公地点");
    expect(container.querySelector(".legal-missing-info-card")).not.toBeNull();
    expect(phase.kind).toBe("task");
    await act(async () => buttonByText(container, "电子打卡").click());
    await sendText(container, "我要模板");
    await sendText(container, "打开录音");
    expect(container.querySelector(".legal-missing-info-card")).not.toBeNull();
    expect(container.querySelector(".legal-template-card")).toBeNull();
    expect(container.querySelector(".legal-record-card")).toBeNull();
    expect(container.querySelector(".legal-workflow-actions")).toBeNull();
    expect(buttonByText(container, "电子打卡").getAttribute("aria-checked")).toBe("true");
    await act(async () => buttonByText(container, "确认").click());
    expect(container.querySelector(".legal-missing-info-card")).toBeNull();
    expect(container.querySelector(".legal-workflow-actions")).not.toBeNull();
    expect(container.querySelector(".litrev-qa-summary")?.textContent).toContain("电子打卡");
    for (let i = 0; i < 10 && phase.kind !== "review"; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(LEGAL_DIAG_TODO_INTERVAL_MS); });
    }
    expect(phase.kind).toBe("review");
    expect(container.querySelectorAll(".litrev-file-card")).toHaveLength(1);
    await act(async () => buttonByText(container, "用工风险诊断报告.docx").click());
    expect(openedArtifacts).toEqual(["reports/用工风险诊断报告.docx"]);

    await sendText(container, "打开待核实问题");
    container.querySelector<HTMLElement>(".legal-active-card")!.scrollTop = 40;
    await sendText(container, "先聊聊");
    expect([...container.querySelectorAll(".legal-workflow-shortcuts button")].map((button) => button.textContent)).toEqual(["诊断指引", "访谈录音"]);
    await act(async () => shortcut(container, "诊断指引").click());
    await sendText(container, "打开待核实问题");
    expect(container.querySelector<HTMLElement>(".legal-active-card")!.scrollTop).toBe(0);
    expect(buttonByText(container, "电子打卡").getAttribute("aria-checked")).toBe("true");
  });

  it("continues the remaining TODOs when the user explicitly skips verification in chat", async () => {
    await sendText(container, "这是一份访谈记录");
    await sendText(container, "生成诊断报告");
    for (let i = 0; i < 15 && !container.querySelector(".legal-missing-info-card"); i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(LEGAL_DIAG_TODO_INTERVAL_MS); });
    }
    expect(phase.kind).toBe("task");
    await sendText(container, "暂不补充");
    expect(container.querySelector(".legal-missing-info-card")).toBeNull();
    for (let i = 0; i < 10 && phase.kind !== "review"; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(LEGAL_DIAG_TODO_INTERVAL_MS); });
    }
    expect(phase.kind).toBe("review");
    expect(container.textContent).toContain("相关项目保留为待核实");
  });

});

function shortcut(container: HTMLElement, label: string): HTMLButtonElement {
  return buttonByText(container.querySelector<HTMLElement>(".legal-workflow-shortcuts")!, label);
}

async function sendText(container: HTMLElement, text: string) {
  const composer = container.querySelector<HTMLTextAreaElement>(".litrev-composer textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(composer, text);
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!.click());
}

function openAttachments(container: HTMLElement) {
  const menu = container.querySelector<HTMLDetailsElement>(".agent-composer-attach-menu")!;
  if (!menu.open) menu.querySelector<HTMLElement>("summary")!.click();
}
