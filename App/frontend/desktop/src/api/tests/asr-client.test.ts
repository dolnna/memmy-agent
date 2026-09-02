// @vitest-environment happy-dom

import type { RuntimeConfig } from "@memmy/local-api-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createHttpAsrClient,
  type AsrRealtimeWebSocketLike
} from "../asr-client.js";

describe("ASR HTTP/WebSocket client", () => {
  it("authenticates against the local real-time proxy and streams normalized events", async () => {
    const socket = new FakeWebSocket();
    const transcripts: unknown[] = [];
    let socketUrl = "";
    const client = createHttpAsrClient(runtimeConfig(), (url) => {
      socketUrl = url;
      return socket;
    });
    const opening = client.startRealtime({
      languageHints: ["zh", "en"],
      onTranscript: (event) => transcripts.push(event)
    });

    socket.open();
    expect(socketUrl).toBe("ws://127.0.0.1:43123/api/asr/realtime?token=runtime-secret");
    expect(JSON.parse(String(socket.sent[0]))).toEqual({
      type: "start",
      sampleRate: 16000,
      languageHints: ["zh", "en"]
    });
    socket.message({ type: "ready", taskId: "task-1", modelId: "qwen-audio-3.0-asr-flash-streaming" });
    const session = await opening;

    session.sendAudio(Uint8Array.from([1, 2, 3]));
    expect(socket.sent[1]).toEqual(Uint8Array.from([1, 2, 3]));
    socket.message({
      type: "transcript",
      sentenceId: 1,
      startMs: 100,
      endMs: null,
      text: "正在识别",
      final: false,
      words: []
    });
    expect(transcripts).toEqual([{
      type: "transcript",
      sentenceId: 1,
      startMs: 100,
      endMs: null,
      text: "正在识别",
      final: false,
      words: []
    }]);

    const finishing = session.finish();
    expect(JSON.parse(String(socket.sent[2]))).toEqual({ type: "finish" });
    socket.message({ type: "finished", taskId: "task-1" });
    await expect(finishing).resolves.toBeUndefined();
  });

  it("surfaces local proxy errors without inventing transcript text", async () => {
    const socket = new FakeWebSocket();
    const onError = vi.fn();
    const client = createHttpAsrClient(runtimeConfig(), () => socket);
    const opening = client.startRealtime({ onTranscript: vi.fn(), onError });
    socket.open();
    socket.message({ type: "error", code: "unauthorized", message: "ASR key is invalid" });
    await expect(opening).rejects.toMatchObject({ message: "ASR key is invalid", code: "unauthorized" });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

function runtimeConfig(): RuntimeConfig {
  return {
    baseUrl: "http://127.0.0.1:43123",
    localToken: "runtime-secret",
    timeZone: "Asia/Shanghai",
    agentGateway: {
      baseUrl: "http://127.0.0.1:43124",
      bootstrapToken: "gateway-secret"
    }
  };
}

class FakeWebSocket implements AsrRealtimeWebSocketLike {
  readyState = 0;
  binaryType: BinaryType = "blob";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  sent: unknown[] = [];

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }
}
