// @vitest-environment happy-dom

/** Asr recorder tests. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AsrClient } from "../../api/asr-client.js";
import {
  type AsrRecorder,
  MicrophonePermissionError,
  ensureMicrophoneAccess,
  isMicrophonePermissionDenial,
  microphonePermissionDeniedMessageKey,
  resampleToPcm16,
  useAsrRecorder
} from "../asr-recorder.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ASR recorder microphone access", () => {
  it("resamples Web Audio frames into signed 16-bit little-endian PCM", () => {
    const pcm = resampleToPcm16(new Float32Array([-1, -0.5, 0, 0.5, 1]), 16_000, 16_000);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    expect(pcm.byteLength).toBe(10);
    expect(view.getInt16(0, true)).toBe(-32768);
    expect(view.getInt16(4, true)).toBe(0);
    expect(view.getInt16(8, true)).toBe(32767);
    expect(resampleToPcm16(new Float32Array([1, 1, -1, -1]), 32_000, 16_000).byteLength).toBe(4);
  });

  it("用户拒绝后再次点击仍会重新请求权限但不会视为已授权", async () => {
    const bridge = {
      getMicrophoneAccessStatus: vi.fn(async () => "denied" as const),
      requestMicrophoneAccess: vi.fn(async () => "denied" as const)
    };

    await expect(ensureMicrophoneAccess(bridge)).rejects.toBeInstanceOf(MicrophonePermissionError);

    expect(bridge.getMicrophoneAccessStatus).toHaveBeenCalledTimes(1);
    expect(bridge.requestMicrophoneAccess).toHaveBeenCalledTimes(1);
  });

  it("已授权时不重复请求系统权限", async () => {
    const bridge = {
      getMicrophoneAccessStatus: vi.fn(async () => "granted" as const),
      requestMicrophoneAccess: vi.fn(async () => "granted" as const)
    };

    await expect(ensureMicrophoneAccess(bridge)).resolves.toBe("granted");

    expect(bridge.getMicrophoneAccessStatus).toHaveBeenCalledTimes(1);
    expect(bridge.requestMicrophoneAccess).not.toHaveBeenCalled();
  });

  it("受系统限制时直接阻断录音启动", async () => {
    const bridge = {
      getMicrophoneAccessStatus: vi.fn(async () => "restricted" as const),
      requestMicrophoneAccess: vi.fn(async () => "granted" as const)
    };

    await expect(ensureMicrophoneAccess(bridge)).rejects.toMatchObject({
      status: "restricted"
    });

    expect(bridge.requestMicrophoneAccess).not.toHaveBeenCalled();
  });

  it("未决定时放行给 getUserMedia 弹出系统权限窗", async () => {
    const bridge = {
      getMicrophoneAccessStatus: vi.fn(async () => "not-determined" as const),
      requestMicrophoneAccess: vi.fn(async () => "not-determined" as const)
    };

    await expect(ensureMicrophoneAccess(bridge)).resolves.toBe("not-determined");
    expect(bridge.requestMicrophoneAccess).toHaveBeenCalledTimes(1);
  });

  it("按平台返回麦克风权限引导文案 key", () => {
    expect(microphonePermissionDeniedMessageKey("darwin")).toBe("asr.error.microphonePermissionDenied.mac");
    expect(microphonePermissionDeniedMessageKey("win32")).toBe("asr.error.microphonePermissionDenied.windows");
    expect(microphonePermissionDeniedMessageKey(undefined)).toBe("asr.error.microphonePermissionDenied.mac");
  });

  it("识别 getUserMedia 权限拒绝错误", () => {
    expect(isMicrophonePermissionDenial(new DOMException("Permission denied", "NotAllowedError"))).toBe(true);
    expect(isMicrophonePermissionDenial(new Error("network offline"))).toBe(false);
  });

  it("在上游转写失败前先交付完整录音 Blob", async () => {
    const events: string[] = [];
    const captured: Array<{ blob: Blob; mimeType: string; durationMs?: number; recordedAt: string }> = [];
    const transcriptionRequests: unknown[] = [];
    const stopTrack = vi.fn();
    const originalMediaDevices = navigator.mediaDevices;
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const asrClient: AsrClient = {
      async startRealtime() { throw new Error("not used"); },
      async transcribe(input) {
        transcriptionRequests.push(input);
        events.push("asr");
        throw new Error("ASR upstream request failed");
      }
    };
    let recorder: AsrRecorder | null = null;
    const container = document.createElement("div");
    document.body.append(container);
    const root: Root = createRoot(container);

    function Harness() {
      recorder = useAsrRecorder(asrClient, {
        onAudioCaptured(audio) {
          events.push("audio");
          captured.push(audio);
        },
        transcribeOptions: {
          diarizationEnabled: true
        }
      });
      return null;
    }

    await act(async () => root.render(createElement(Harness)));
    await act(async () => recorder!.start());
    await act(async () => {
      await expect(recorder!.finishAndTranscribe()).rejects.toThrow("ASR upstream request failed");
    });

    expect(events).toEqual(["audio", "asr"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.blob.size).toBeGreaterThan(0);
    expect(captured[0]?.mimeType).toBe("audio/webm;codecs=opus");
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { channelCount: 1 } });
    expect(transcriptionRequests).toEqual([
      expect.objectContaining({
        diarizationEnabled: true,
        mimeType: "audio/webm"
      })
    ]);
    expect(stopTrack).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
  });

  it("单声道约束不受设备支持时回退到通用音频约束", async () => {
    const originalMediaDevices = navigator.mediaDevices;
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] };
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException("channelCount unavailable", "OverconstrainedError"))
      .mockResolvedValueOnce(stream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const asrClient: AsrClient = {
      async startRealtime() { throw new Error("not used"); },
      async transcribe() {
        return {
          text: "",
          modelId: "qwen3-asr-flash",
          provider: "aliyun",
          source: "byok",
          transcribedAt: "2026-09-01T00:00:00.000Z"
        };
      }
    };
    let recorder: AsrRecorder | null = null;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    function Harness() {
      recorder = useAsrRecorder(asrClient);
      return null;
    }

    await act(async () => root.render(createElement(Harness)));
    await act(async () => recorder!.start());
    expect(getUserMedia).toHaveBeenNthCalledWith(1, { audio: { channelCount: 1 } });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: true });

    act(() => root.unmount());
    expect(stopTrack).toHaveBeenCalledTimes(1);
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
  });
});

class FakeMediaRecorder {
  static isTypeSupported(type: string) {
    return type === "audio/webm;codecs=opus";
  }

  readonly mimeType: string;
  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType || "audio/webm";
  }

  start() {
    this.state = "recording";
  }

  pause() {
    this.state = "paused";
  }

  resume() {
    this.state = "recording";
  }

  requestData() {
    this.ondataavailable?.({ data: new Blob(["recorded-audio"], { type: this.mimeType }) } as BlobEvent);
  }

  stop() {
    this.state = "inactive";
    this.onstop?.(new Event("stop"));
  }
}
