/** DashScope real-time ASR WebSocket adapter tests. */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ClientOptions, RawData } from "ws";
import {
  openDashScopeRealtimeSession,
  toDashScopeRealtimeUrl,
  type RealtimeSocket
} from "../dashscope-realtime-transcription.js";

describe("DashScope real-time transcription", () => {
  it("starts an authenticated Qwen streaming task, forwards PCM, and maps transcript events", async () => {
    const socket = new FakeSocket();
    const transcripts: unknown[] = [];
    let socketUrl = "";
    let socketOptions: ClientOptions | undefined;
    const opening = openDashScopeRealtimeSession({
      provider: provider(),
      languageHints: ["zh", "en"],
      onTranscript: (event) => transcripts.push(event),
      createSocket(url, options) {
        socketUrl = url;
        socketOptions = options;
        return socket;
      }
    });

    socket.open();
    const runTask = JSON.parse(String(socket.sent[0])) as any;
    expect(socketUrl).toBe("wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference");
    expect(socketOptions?.headers).toMatchObject({
      Authorization: "Bearer endpoint-secret",
      "x-endpoint-auth": "endpoint"
    });
    expect(runTask).toMatchObject({
      header: { action: "run-task", streaming: "duplex" },
      payload: {
        task_group: "audio",
        task: "asr",
        function: "recognition",
        model: "qwen-audio-3.0-asr-flash-streaming",
        parameters: {
          format: "pcm",
          sample_rate: 16000,
          semantic_punctuation_enabled: true,
          language_hints: ["zh", "en"]
        }
      }
    });
    socket.message({ header: { event: "task-started" }, payload: {} });
    const session = await opening;

    session.sendAudio(Uint8Array.from([1, 2, 3, 4]));
    expect(socket.sent[1]).toEqual(Uint8Array.from([1, 2, 3, 4]));
    socket.message({
      header: { event: "result-generated" },
      payload: {
        output: {
          sentence: {
            sentence_id: 1,
            begin_time: 170,
            end_time: 920,
            text: "好，我知道了",
            sentence_end: true,
            words: [{ begin_time: 170, end_time: 295, text: "好", punctuation: "，" }]
          }
        }
      }
    });
    expect(transcripts).toEqual([{
      type: "transcript",
      sentenceId: 1,
      startMs: 170,
      endMs: 920,
      text: "好，我知道了",
      final: true,
      words: [{ text: "好", startMs: 170, endMs: 295, punctuation: "，" }]
    }]);

    const finishing = session.finish();
    expect(JSON.parse(String(socket.sent[2]))).toMatchObject({
      header: { action: "finish-task", task_id: session.taskId, streaming: "duplex" },
      payload: { input: {} }
    });
    socket.message({ header: { event: "task-finished" }, payload: {} });
    await expect(finishing).resolves.toBeUndefined();
  });

  it("reports an upstream task failure instead of fabricating transcript text", async () => {
    const socket = new FakeSocket();
    const onError = vi.fn();
    const opening = openDashScopeRealtimeSession({
      provider: provider(),
      onTranscript: vi.fn(),
      onError,
      createSocket: () => socket
    });
    socket.open();
    socket.message({
      header: {
        event: "task-failed",
        error_code: "InvalidApiKey",
        error_message: "API key is invalid"
      },
      payload: {}
    });
    await expect(opening).rejects.toMatchObject({
      message: "API key is invalid (InvalidApiKey)",
      code: "InvalidApiKey"
    });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("derives both workspace and legacy WebSocket inference URLs", () => {
    expect(toDashScopeRealtimeUrl("https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"))
      .toBe("wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference");
    expect(toDashScopeRealtimeUrl("https://dashscope.aliyuncs.com/compatible-mode/v1"))
      .toBe("wss://dashscope.aliyuncs.com/api-ws/v1/inference");
  });
});

function provider() {
  return {
    provider: "dashscope",
    endpointId: "asr",
    protocol: "dashscope-input-audio-chat" as const,
    apiBase: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    apiKey: "endpoint-secret",
    extraHeaders: { "x-endpoint-auth": "endpoint" },
    extraBody: {}
  };
}

class FakeSocket extends EventEmitter implements RealtimeSocket {
  readyState = 0;
  sent: Array<string | Uint8Array> = [];

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.emit("close", code, Buffer.from(reason));
  }

  open(): void {
    this.readyState = 1;
    this.emit("open");
  }

  message(value: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(value)) as RawData, false);
  }
}
