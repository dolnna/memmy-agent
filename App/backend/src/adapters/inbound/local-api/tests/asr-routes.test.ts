/** ASR local route tests. */
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  ASR_TRANSCRIPTION_BODY_LIMIT_BYTES,
  registerAsrRoutes
} from "../routes/asr.js";

describe("ASR routes", () => {
  it("accepts audio payloads larger than Fastify's default one MiB limit", async () => {
    const app = Fastify({ logger: false });
    let receivedAudioLength = 0;
    registerAsrRoutes(app, {
      asr: {
        async openRealtime() {
          throw new Error("not used");
        },
        async transcribe(input) {
          receivedAudioLength = input.audioBase64.length;
          return {
            text: "ok",
            modelId: "qwen3-asr-flash",
            provider: "dashscope",
            source: "byok",
            transcribedAt: "2026-09-01T12:00:00.000Z"
          };
        }
      },
      authenticateRuntimeToken: async () => undefined
    });

    const audioBase64 = "A".repeat(2 * 1024 * 1024);
    const response = await app.inject({
      method: "POST",
      url: "/api/asr/transcriptions",
      payload: { audioBase64, mimeType: "audio/webm", diarizationEnabled: true }
    });

    expect(ASR_TRANSCRIPTION_BODY_LIMIT_BYTES).toBe(128 * 1024 * 1024);
    expect(response.statusCode).toBe(200);
    expect(receivedAudioLength).toBe(audioBase64.length);
    await app.close();
  });

  it("proxies authenticated renderer PCM frames through a real-time ASR session", async () => {
    const app = Fastify({ logger: false });
    const audioFrames: Uint8Array[] = [];
    let emitTranscript: ((event: any) => void) | undefined;
    registerAsrRoutes(app, {
      asr: {
        async transcribe() { throw new Error("not used"); },
        async openRealtime(input) {
          emitTranscript = input.onTranscript;
          return {
            taskId: "task-local-1",
            modelId: "qwen-audio-3.0-asr-flash-streaming",
            sendAudio(audio) { audioFrames.push(Uint8Array.from(audio)); },
            async finish() { return undefined; },
            close() { return undefined; }
          };
        }
      },
      authenticateRuntimeToken: async () => undefined,
      verifyRuntimeToken: async (token) => token === "runtime-secret",
      isOriginAllowed: () => true
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("missing server port");
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/api/asr/realtime?token=runtime-secret`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });

    client.send(JSON.stringify({ type: "start", sampleRate: 16_000, languageHints: ["zh"] }));
    await expect(nextMessage(client)).resolves.toMatchObject({
      type: "ready",
      taskId: "task-local-1",
      modelId: "qwen-audio-3.0-asr-flash-streaming"
    });
    client.send(Uint8Array.from([1, 2, 3, 4]));
    await waitFor(() => audioFrames.length === 1);
    expect(audioFrames).toEqual([Uint8Array.from([1, 2, 3, 4])]);

    const transcriptPromise = nextMessage(client);
    emitTranscript?.({
      type: "transcript",
      sentenceId: 1,
      startMs: 100,
      endMs: null,
      text: "真实实时字幕",
      final: false,
      words: []
    });
    await expect(transcriptPromise).resolves.toMatchObject({ type: "transcript", text: "真实实时字幕" });

    const finishedPromise = nextMessage(client);
    client.send(JSON.stringify({ type: "finish" }));
    await expect(finishedPromise).resolves.toMatchObject({ type: "finished", taskId: "task-local-1" });
    await new Promise<void>((resolve) => client.once("close", () => resolve()));
    await app.close();
  });
});

function nextMessage(client: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    client.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    client.once("error", reject);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
