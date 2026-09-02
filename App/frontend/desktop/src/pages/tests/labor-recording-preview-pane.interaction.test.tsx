// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import {
  LegalRecordingCollectionPreview,
  LegalRecordingPreviewPane,
  orderLegalRecordingItems,
  parseLegalTranscript,
  type LegalRecordingPreviewState
} from "../labor-recording-preview-pane.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FINAL_TRANSCRIPT = [
  "发言人 1  00:00",
  "我们先了解公司的劳动合同情况。",
  "",
  "发言人 2  00:18",
  "公司已经提供了合同模板。"
].join("\n");

describe("LegalRecordingPreviewPane", () => {
  let container: HTMLDivElement;
  let root: Root;
  const createObjectUrl = vi.fn(() => "blob:legal-recording");
  const revokeObjectUrl = vi.fn();
  let playAudio: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    playAudio = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    createObjectUrl.mockClear();
    revokeObjectUrl.mockClear();
    playAudio.mockRestore();
  });

  async function render(state: LegalRecordingPreviewState) {
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <LegalRecordingPreviewPane state={state} />
        </I18nProvider>
      );
      await Promise.resolve();
    });
  }

  it("shows real provisional WebSocket transcript events beside the recording timer", async () => {
    await render({
      mode: "recording",
      elapsedSeconds: 8,
      transcript: "我们今天主要了解公司现有的用工管理情况。",
      transcriptSource: "asr",
      liveSegments: [{
        type: "transcript",
        sentenceId: 1,
        startMs: 1_250,
        endMs: null,
        text: "我们今天主要了解公司现有的用工管理情况。",
        final: false,
        words: []
      }]
    });

    expect(container.textContent).toContain("实时转写");
    expect(container.textContent).toContain("正在录音");
    expect(container.textContent).toContain("00:08");
    expect(container.textContent).toContain("我们今天主要了解公司现有的用工管理情况");
    expect(container.textContent).toContain("00:01");
    expect(container.textContent).not.toContain("AI 纪要");
  });

  it("switches to a minimal player and speaker transcript after recording ends", async () => {
    await render({
      mode: "completed",
      elapsedSeconds: 86,
      transcript: FINAL_TRANSCRIPT,
      transcriptSource: "asr",
      recording: {
        id: "recording-1",
        blob: new Blob(["recording"], { type: "audio/webm" }),
        mimeType: "audio/webm",
        durationMs: 86_000,
        name: "现场访谈录音.webm"
      }
    });

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("访谈录音");
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(container.querySelector('[role="tab"]')?.textContent).toBe("转写");
    expect(container.textContent).toContain("发言人 1");
    expect(container.textContent).toContain("发言人 2");
    expect(container.textContent).not.toContain("POC 演示");
    expect(container.textContent).not.toContain("AI 纪要");
    expect(container.textContent).not.toContain("章节");
    expect(container.textContent).not.toContain("1.0 x");
    expect(container.querySelector('[aria-label="播放录音"]')).not.toBeNull();
    expect(container.querySelector(".legal-recording-player__timeline > button")?.getAttribute("aria-label")).toBe("播放录音");
    expect(container.querySelector(".legal-recording-player > button")).toBeNull();

    await render({ mode: "idle", elapsedSeconds: 0, transcript: "", transcriptSource: null });
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:legal-recording");
  });

  it("parses speaker labels and timestamps from the final transcript", () => {
    const segments = parseLegalTranscript(FINAL_TRANSCRIPT);
    expect(segments.map((segment) => [segment.speaker, segment.time])).toEqual([
      ["发言人 1", "00:00"],
      ["发言人 2", "00:18"]
    ]);
  });

  it("prefers structured ASR segments and seeks the original audio when a segment is clicked", async () => {
    await render({
      mode: "completed",
      elapsedSeconds: 70,
      transcript: FINAL_TRANSCRIPT,
      transcriptSource: "asr",
      segments: [
        { id: "segment-a", speakerId: 0, startMs: 17_250, endMs: 24_000, text: "结构化第一段", words: [] },
        { id: "segment-b", speakerId: 2, startMs: 61_000, endMs: 68_000, text: "结构化第二段", words: [] }
      ],
      recording: {
        id: "recording-structured",
        blob: new Blob(["recording"], { type: "audio/webm" }),
        mimeType: "audio/webm",
        durationMs: 70_000,
        name: "结构化访谈.webm"
      }
    });

    const transcriptSegments = [...container.querySelectorAll<HTMLElement>(".legal-recording-transcript__segment")];
    expect(transcriptSegments).toHaveLength(2);
    expect(transcriptSegments[0]?.textContent).toContain("发言人 1");
    expect(transcriptSegments[0]?.textContent).toContain("00:17");
    expect(transcriptSegments[0]?.textContent).toContain("结构化第一段");
    expect(transcriptSegments[1]?.textContent).toContain("发言人 3");
    expect(transcriptSegments[1]?.textContent).toContain("01:01");
    expect(container.textContent).not.toContain("我们今天主要想了解公司现有的用工管理情况");

    const audio = container.querySelector<HTMLAudioElement>("audio")!;
    await act(async () => transcriptSegments[0]?.click());
    expect(audio.currentTime).toBe(17.25);
    expect(playAudio).toHaveBeenCalledTimes(1);
  });

  it("opens a recording list before starting and uses one live-session control surface", async () => {
    const onStart = vi.fn();
    const onPause = vi.fn();
    const onFinish = vi.fn();
    const onBack = vi.fn();
    const idle: LegalRecordingPreviewState = { mode: "idle", elapsedSeconds: 0, transcript: "", transcriptSource: null };

    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <LegalRecordingCollectionPreview
            surface="list"
            items={[]}
            activeState={idle}
            activeLabel="访谈录音"
            canSkip
            onStart={onStart}
            onUpload={() => undefined}
            onSkip={() => undefined}
            onSelect={() => undefined}
            onBack={onBack}
            onPause={onPause}
            onResume={() => undefined}
            onFinish={onFinish}
          />
        </I18nProvider>
      );
    });

    expect(container.textContent).toContain("录音列表");
    expect(container.textContent).toContain("当前目录暂无录音");
    expect(container.textContent).not.toContain("正在录音");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("开始录音"))!.click());
    expect(onStart).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <LegalRecordingCollectionPreview
            surface="session"
            items={[]}
            activeState={{ mode: "recording", elapsedSeconds: 9, transcript: "", transcriptSource: null }}
            activeLabel="现场访谈录音"
            onStart={onStart}
            onUpload={() => undefined}
            onSelect={() => undefined}
            onBack={onBack}
            onPause={onPause}
            onResume={() => undefined}
            onFinish={onFinish}
          />
        </I18nProvider>
      );
    });

    expect(container.textContent).toContain("正在录音");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("暂停"))!.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("结束并转写"))!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="返回录音列表"]')!.click());
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows recording time, duration, participant count, and transcript status in the list", async () => {
    const onRename = vi.fn();
    const onSelect = vi.fn();
    const onAddToConversation = vi.fn();
    const completed: LegalRecordingPreviewState = {
      mode: "completed",
      elapsedSeconds: 76,
      transcript: FINAL_TRANSCRIPT,
      transcriptSource: "mock",
      recording: {
        id: "recording-meta",
        blob: new Blob(["recording"], { type: "audio/mp4" }),
        mimeType: "audio/mp4",
        durationMs: 76_000,
        recordedAt: "2026-09-02T10:30:00",
        name: "劳动用工访谈.m4a"
      }
    };
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <LegalRecordingCollectionPreview
            surface="list"
            items={[{ id: "recording-meta", label: "劳动用工访谈.m4a", state: completed }]}
            activeState={completed}
            activeLabel="劳动用工访谈.m4a"
            onStart={() => undefined}
            onUpload={() => undefined}
            onSelect={onSelect}
            onRename={onRename}
            onAddToConversation={onAddToConversation}
            onBack={() => undefined}
            onPause={() => undefined}
            onResume={() => undefined}
            onFinish={() => undefined}
          />
        </I18nProvider>
      );
    });

    const item = container.querySelector(".legal-recording-library__item")!;
    expect(item.textContent).toContain("劳动用工访谈.m4a");
    expect(item.textContent).toContain("2026-09-02 10:30");
    expect(item.textContent).toContain("时长 01:16");
    expect(item.textContent).toContain("2 人参与");
    expect(item.textContent).toContain("已转写");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开 劳动用工访谈.m4a"]')!.click());
    expect(onSelect).toHaveBeenCalledWith("recording-meta");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="将 劳动用工访谈.m4a 的转写添加到对话"]')!.click());
    expect(onAddToConversation).toHaveBeenCalledWith(expect.objectContaining({ id: "recording-meta" }));

    const addDraggedFile = vi.fn();
    const setDragData = vi.fn();
    const dragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, "dataTransfer", {
      value: { effectAllowed: "none", setData: setDragData, items: { add: addDraggedFile } }
    });
    await act(async () => item.querySelector(".legal-recording-library__item-main")!.dispatchEvent(dragStart));
    expect(addDraggedFile).toHaveBeenCalledWith(expect.objectContaining({ name: "劳动用工访谈-转写.txt", type: "text/plain" }));
    expect(setDragData).toHaveBeenCalledWith("application/x-memmy-recording-transcript", "recording-meta");

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="重命名 劳动用工访谈.m4a"]')!.click());
    const input = container.querySelector<HTMLInputElement>('[aria-label="重命名录音"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "上海工厂访谈");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.closest("form")!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })));
    expect(onRename).toHaveBeenCalledWith("recording-meta", "上海工厂访谈");
  });

  it("shows every recording in stable newest-first order", async () => {
    const original = [
      { id: "old", label: "第一次访谈", createdAt: "2026-09-01T09:00:00Z", state: { mode: "completed" as const, elapsedSeconds: 10, transcript: "一", transcriptSource: "asr" as const } },
      { id: "new", label: "第三次访谈", createdAt: "2026-09-03T09:00:00Z", state: { mode: "completed" as const, elapsedSeconds: 10, transcript: "三", transcriptSource: "asr" as const } },
      { id: "middle", label: "第二次访谈", createdAt: "2026-09-02T09:00:00Z", state: { mode: "completed" as const, elapsedSeconds: 10, transcript: "二", transcriptSource: "asr" as const } },
      { id: "fallback", label: "回退时间访谈", createdAt: "2026-09-04T09:00:00Z", state: {
        mode: "completed" as const,
        elapsedSeconds: 10,
        transcript: "四",
        transcriptSource: "asr" as const,
        recording: {
          id: "fallback",
          blob: new Blob(["audio"]),
          mimeType: "audio/webm",
          recordedAt: "invalid-date",
          name: "fallback.webm"
        }
      } }
    ];
    expect(orderLegalRecordingItems(original).map((item) => item.id)).toEqual(["fallback", "new", "middle", "old"]);
    expect(original.map((item) => item.id)).toEqual(["old", "new", "middle", "fallback"]);

    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <LegalRecordingCollectionPreview
            surface="list"
            items={original}
            activeState={original[1]!.state}
            activeLabel={original[1]!.label}
            onStart={() => undefined}
            onUpload={() => undefined}
            onSelect={onSelect}
            onBack={() => undefined}
            onPause={() => undefined}
            onResume={() => undefined}
            onFinish={() => undefined}
          />
        </I18nProvider>
      );
    });

    const labels = [...container.querySelectorAll(".legal-recording-library__item-copy strong")].map((node) => node.textContent);
    expect(labels).toEqual(["回退时间访谈", "第三次访谈", "第二次访谈", "第一次访谈"]);
    expect(container.querySelectorAll(".legal-recording-library__item")).toHaveLength(4);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开 第一次访谈"]')!.click());
    expect(onSelect).toHaveBeenCalledWith("old");
  });
});
