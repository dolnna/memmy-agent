import {
  ASR_REALTIME_SAMPLE_RATE,
  AsrRealtimeServerEventSchema,
  AsrTranscriptionInputSchema,
  AsrTranscriptionResponseSchema,
  type AsrRealtimeTranscriptEvent,
  type AsrTranscriptionInput,
  type AsrTranscriptionResponse,
  type RuntimeConfig
} from "@memmy/local-api-contracts";
import { requestJson } from "./http.js";

export interface AsrClient {
  transcribe(input: AsrTranscriptionInput): Promise<AsrTranscriptionResponse>;
  startRealtime(input: AsrRealtimeStartOptions): Promise<AsrRealtimeSession>;
}

export interface AsrRealtimeStartOptions {
  languageHints?: string[];
  onTranscript: (event: AsrRealtimeTranscriptEvent) => void;
  onError?: (error: Error) => void;
}

export interface AsrRealtimeSession {
  sendAudio(audio: Uint8Array): void;
  finish(): Promise<void>;
  close(): void;
}

export interface AsrRealtimeWebSocketLike {
  readonly readyState: number;
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

export function createHttpAsrClient(
  config: RuntimeConfig,
  webSocketFactory: (url: string) => AsrRealtimeWebSocketLike = (url) => new WebSocket(url)
): AsrClient {
  return {
    async transcribe(input) {
      return requestJson({
        config,
        path: "/api/asr/transcriptions",
        schema: AsrTranscriptionResponseSchema,
        body: AsrTranscriptionInputSchema.parse(input)
      });
    },
    startRealtime(input) {
      return openRealtimeSession(config, input, webSocketFactory);
    }
  };
}

const REALTIME_READY_TIMEOUT_MS = 20_000;
const REALTIME_FINISH_TIMEOUT_MS = 10_000;

async function openRealtimeSession(
  config: RuntimeConfig,
  input: AsrRealtimeStartOptions,
  webSocketFactory: (url: string) => AsrRealtimeWebSocketLike
): Promise<AsrRealtimeSession> {
  const socket = webSocketFactory(realtimeWebSocketUrl(config));
  socket.binaryType = "arraybuffer";
  let ready = false;
  let closedByClient = false;
  let finishRequested = false;
  let finishSettled = false;
  let resolveFinish: (() => void) | null = null;
  let rejectFinish: ((error: Error) => void) | null = null;

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      closedByClient = true;
      socket.close(1000, "ready timeout");
      reject(new Error("Real-time ASR connection timed out"));
    }, REALTIME_READY_TIMEOUT_MS);

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: "start",
        sampleRate: ASR_REALTIME_SAMPLE_RATE,
        ...(input.languageHints?.length ? { languageHints: input.languageHints } : {})
      }));
    };
    socket.onmessage = (message) => {
      const event = parseRealtimeEvent(message.data);
      if (!event) return;
      if (event.type === "ready") {
        ready = true;
        window.clearTimeout(timeout);
        resolve();
        return;
      }
      if (event.type === "transcript") {
        input.onTranscript(event);
        return;
      }
      if (event.type === "finished") {
        finishSettled = true;
        resolveFinish?.();
        return;
      }
      const error = Object.assign(new Error(event.message), { code: event.code });
      input.onError?.(error);
      if (!ready) reject(error);
      rejectFinish?.(error);
    };
    socket.onerror = () => {
      const error = new Error("Real-time ASR WebSocket failed");
      input.onError?.(error);
      window.clearTimeout(timeout);
      if (!ready) reject(error);
      rejectFinish?.(error);
    };
    socket.onclose = (event) => {
      window.clearTimeout(timeout);
      if (closedByClient || finishSettled) return;
      const error = new Error(event.reason || `Real-time ASR WebSocket closed (${event.code})`);
      if (!ready) reject(error);
      rejectFinish?.(error);
    };
  });

  return {
    sendAudio(audio) {
      if (!ready || finishRequested || socket.readyState !== WebSocket.OPEN || audio.byteLength === 0) return;
      socket.send(audio);
    },
    finish() {
      if (finishSettled) return Promise.resolve();
      if (!finishRequested) {
        finishRequested = true;
        socket.send(JSON.stringify({ type: "finish" }));
      }
      const completion = new Promise<void>((resolve, reject) => {
        const previousResolve = resolveFinish;
        const previousReject = rejectFinish;
        resolveFinish = () => { previousResolve?.(); resolve(); };
        rejectFinish = (error) => { previousReject?.(error); reject(error); };
      });
      let timeoutId = 0;
      const timeout = new Promise<void>((_resolve, reject) => {
        timeoutId = window.setTimeout(() => {
          closedByClient = true;
          socket.close(1000, "finish timeout");
          reject(new Error("Real-time ASR finish timed out"));
        }, REALTIME_FINISH_TIMEOUT_MS);
      });
      return Promise.race([completion, timeout]).finally(() => window.clearTimeout(timeoutId));
    },
    close() {
      closedByClient = true;
      socket.close(1000, "client closed");
    }
  };
}

function realtimeWebSocketUrl(config: RuntimeConfig): string {
  const url = new URL("/api/asr/realtime", config.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", config.localToken);
  return url.toString();
}

function parseRealtimeEvent(value: unknown) {
  try {
    const text = typeof value === "string" ? value : value instanceof ArrayBuffer
      ? new TextDecoder().decode(value)
      : "";
    return AsrRealtimeServerEventSchema.parse(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
