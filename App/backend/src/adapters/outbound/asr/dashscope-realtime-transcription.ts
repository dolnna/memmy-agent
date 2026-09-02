/** DashScope Qwen-Audio streaming ASR WebSocket adapter. */
import {
  ASR_REALTIME_SAMPLE_RATE,
  AsrRealtimeTranscriptEventSchema,
  QWEN_ASR_REALTIME_MODEL_ID,
  type AsrRealtimeTranscriptEvent,
  type ResolvedProviderSnapshot
} from "@memmy/local-api-contracts";
import { randomUUID } from "node:crypto";
import WebSocket, { type ClientOptions, type RawData } from "ws";

const CONNECT_TIMEOUT_MS = 15_000;
const WEBSOCKET_OPEN = 1;

export interface DashScopeRealtimeSession {
  readonly taskId: string;
  readonly modelId: typeof QWEN_ASR_REALTIME_MODEL_ID;
  sendAudio(audio: Uint8Array): void;
  finish(): Promise<void>;
  close(): void;
}

export interface DashScopeRealtimeOptions {
  provider: Readonly<ResolvedProviderSnapshot>;
  sampleRate?: typeof ASR_REALTIME_SAMPLE_RATE;
  languageHints?: string[];
  onTranscript: (event: AsrRealtimeTranscriptEvent) => void;
  onError?: (error: Error) => void;
  connectTimeoutMs?: number;
  createSocket?: (url: string, options: ClientOptions) => RealtimeSocket;
}

export interface RealtimeSocket {
  readonly readyState: number;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  on(event: "open", listener: () => void): this;
  on(event: "message", listener: (data: RawData, isBinary: boolean) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (code: number, reason: Buffer) => void): this;
}

/** Opens one authenticated DashScope streaming-recognition task. */
export async function openDashScopeRealtimeSession(
  options: DashScopeRealtimeOptions
): Promise<DashScopeRealtimeSession> {
  const apiKey = options.provider.apiKey;
  if (!apiKey) throw realtimeError("DashScope ASR API key is not configured", "unauthorized");

  const taskId = randomUUID();
  const socket = (options.createSocket ?? defaultSocketFactory)(
    toDashScopeRealtimeUrl(options.provider.apiBase),
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...options.provider.extraHeaders
      }
    }
  );
  let started = false;
  let closedByClient = false;
  let finishRequested = false;
  let finishSettled = false;
  let resolveFinish: (() => void) | null = null;
  let rejectFinish: ((error: Error) => void) | null = null;

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      closedByClient = true;
      socket.close(1000, "connect timeout");
      reject(realtimeError("DashScope real-time ASR connection timed out", "internal"));
    }, options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);

    socket.on("open", () => {
      socket.send(JSON.stringify(runTaskMessage({
        taskId,
        sampleRate: options.sampleRate ?? ASR_REALTIME_SAMPLE_RATE,
        languageHints: options.languageHints
      })));
    });

    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      const message = parseServerMessage(data);
      if (!message) return;
      const event = readString(asRecord(message.header).event);
      if (event === "task-started") {
        started = true;
        clearTimeout(timeout);
        resolve();
        return;
      }
      if (event === "result-generated") {
        const transcript = parseTranscriptEvent(message);
        if (transcript) options.onTranscript(transcript);
        return;
      }
      if (event === "task-finished") {
        finishSettled = true;
        resolveFinish?.();
        return;
      }
      if (event === "task-failed") {
        const error = upstreamTaskError(message);
        clearTimeout(timeout);
        if (!started) reject(error);
        rejectFinish?.(error);
        options.onError?.(error);
      }
    });

    socket.on("error", (cause) => {
      const error = realtimeError(cause.message || "DashScope real-time ASR WebSocket failed", "internal");
      clearTimeout(timeout);
      if (!started) reject(error);
      rejectFinish?.(error);
      options.onError?.(error);
    });

    socket.on("close", (code, reason) => {
      clearTimeout(timeout);
      if (closedByClient || finishSettled) return;
      const detail = reason.toString("utf8").trim();
      const error = realtimeError(
        detail ? `DashScope real-time ASR closed: ${detail}` : `DashScope real-time ASR closed (${code})`,
        "internal"
      );
      if (!started) reject(error);
      rejectFinish?.(error);
      options.onError?.(error);
    });
  });

  await ready;

  return {
    taskId,
    modelId: QWEN_ASR_REALTIME_MODEL_ID,
    sendAudio(audio) {
      if (!started || finishRequested || socket.readyState !== WEBSOCKET_OPEN) return;
      if (audio.byteLength > 0) socket.send(audio);
    },
    finish() {
      if (finishSettled) return Promise.resolve();
      if (finishRequested) {
        return new Promise<void>((resolve, reject) => {
          const previousResolve = resolveFinish;
          const previousReject = rejectFinish;
          resolveFinish = () => { previousResolve?.(); resolve(); };
          rejectFinish = (error) => { previousReject?.(error); reject(error); };
        });
      }
      finishRequested = true;
      const completion = new Promise<void>((resolve, reject) => {
        resolveFinish = resolve;
        rejectFinish = reject;
      });
      socket.send(JSON.stringify(finishTaskMessage(taskId)));
      return completion;
    },
    close() {
      closedByClient = true;
      socket.close(1000, "client closed");
    }
  };
}

/** Maps an OpenAI-compatible HTTP base URL to the matching DashScope WebSocket inference URL. */
export function toDashScopeRealtimeUrl(apiBase: string): string {
  const url = new URL(apiBase);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.search = "";
  url.hash = "";
  url.pathname = "/api-ws/v1/inference";
  return url.toString();
}

function defaultSocketFactory(url: string, options: ClientOptions): RealtimeSocket {
  return new WebSocket(url, options);
}

function runTaskMessage(input: {
  taskId: string;
  sampleRate: number;
  languageHints?: string[];
}): Record<string, unknown> {
  const languageHints = input.languageHints?.map((value) => value.trim()).filter(Boolean).slice(0, 4);
  return {
    header: { action: "run-task", task_id: input.taskId, streaming: "duplex" },
    payload: {
      task_group: "audio",
      task: "asr",
      function: "recognition",
      model: QWEN_ASR_REALTIME_MODEL_ID,
      parameters: {
        format: "pcm",
        sample_rate: input.sampleRate,
        semantic_punctuation_enabled: true,
        ...(languageHints?.length ? { language_hints: languageHints } : {})
      },
      input: {}
    }
  };
}

function finishTaskMessage(taskId: string): Record<string, unknown> {
  return {
    header: { action: "finish-task", task_id: taskId, streaming: "duplex" },
    payload: { input: {} }
  };
}

function parseServerMessage(data: RawData): Record<string, unknown> | null {
  try {
    const raw = typeof data === "string"
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data).toString("utf8")
        : Buffer.from(data as ArrayBuffer).toString("utf8");
    const value = JSON.parse(raw) as unknown;
    return asRecord(value);
  } catch {
    return null;
  }
}

function parseTranscriptEvent(message: Record<string, unknown>): AsrRealtimeTranscriptEvent | null {
  const sentence = asRecord(asRecord(asRecord(message.payload).output).sentence);
  if (sentence.heartbeat === true) return null;
  const sentenceId = nonNegativeInteger(sentence.sentence_id);
  const startMs = nonNegativeInteger(sentence.begin_time);
  if (sentenceId === null || startMs === null) return null;
  const rawEndMs = nonNegativeInteger(sentence.end_time);
  const words = (Array.isArray(sentence.words) ? sentence.words : []).flatMap((item) => {
    const word = asRecord(item);
    const wordStart = nonNegativeInteger(word.begin_time);
    const wordEnd = nonNegativeInteger(word.end_time);
    if (wordStart === null || wordEnd === null) return [];
    const punctuation = typeof word.punctuation === "string" ? word.punctuation : undefined;
    return [{
      text: typeof word.text === "string" ? word.text : "",
      startMs: wordStart,
      endMs: Math.max(wordStart, wordEnd),
      ...(punctuation === undefined ? {} : { punctuation })
    }];
  });
  return AsrRealtimeTranscriptEventSchema.parse({
    type: "transcript",
    sentenceId,
    startMs,
    endMs: rawEndMs === null ? null : Math.max(startMs, rawEndMs),
    text: typeof sentence.text === "string" ? sentence.text : "",
    final: sentence.sentence_end === true,
    words
  });
}

function upstreamTaskError(message: Record<string, unknown>): Error {
  const header = asRecord(message.header);
  const code = readString(header.error_code) ?? "internal";
  const detail = readString(header.error_message) ?? "DashScope real-time ASR task failed";
  return realtimeError(`${detail} (${code})`, code);
}

function realtimeError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
