/** Asr module. */
import {
  AsrRealtimeClientMessageSchema,
  AsrRealtimeServerEventSchema,
  AsrTranscriptionInputSchema,
  AsrTranscriptionResponseSchema,
  QWEN_ASR_REALTIME_MODEL_ID,
  type AsrRealtimeServerEvent
} from "@memmy/local-api-contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { AsrService } from "../../../../services/asr-service.js";
import { withErrorEnvelope } from "../../../../services/error-envelope.js";

/** POC ceiling for Base64-encoded audio; production long recordings should use file uploads. */
export const ASR_TRANSCRIPTION_BODY_LIMIT_BYTES = 128 * 1024 * 1024;

/** Contract for register asr routes options. */
export interface RegisterAsrRoutesOptions {
  asr: AsrService;
  authenticateRuntimeToken: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  verifyRuntimeToken?: (token: string) => Promise<boolean>;
  isOriginAllowed?: (origin: string | undefined) => boolean;
}

/** Registers register asr routes. */
export function registerAsrRoutes(app: FastifyInstance, options: RegisterAsrRoutesOptions): void {
  app.post(
    "/api/asr/transcriptions",
    {
      preHandler: options.authenticateRuntimeToken,
      bodyLimit: ASR_TRANSCRIPTION_BODY_LIMIT_BYTES
    },
    withErrorEnvelope(async (request, reply) => {
      const input = AsrTranscriptionInputSchema.parse(request.body);
      const response = AsrTranscriptionResponseSchema.parse(await options.asr.transcribe(input));
      return reply.send(response);
    })
  );

  if (options.verifyRuntimeToken) {
    registerRealtimeAsrWebSocket(app, options);
  }
}

const REALTIME_ASR_PATH = "/api/asr/realtime";
const REALTIME_START_TIMEOUT_MS = 10_000;

function registerRealtimeAsrWebSocket(app: FastifyInstance, options: RegisterAsrRoutesOptions): void {
  const verifyRuntimeToken = options.verifyRuntimeToken;
  if (!verifyRuntimeToken) return;
  const webSocketServer = new WebSocketServer({ noServer: true });

  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "", "http://127.0.0.1");
    } catch {
      return;
    }
    if (url.pathname !== REALTIME_ASR_PATH) return;

    const origin = singleHeader(request.headers.origin);
    const token = url.searchParams.get("token") ?? "";
    void (async () => {
      const allowedOrigin = options.isOriginAllowed?.(origin) ?? true;
      if (!allowedOrigin) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      if (!token || !(await verifyRuntimeToken(token))) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      webSocketServer.handleUpgrade(request, socket, head, (client) => {
        handleRealtimeClient(client, options.asr);
      });
    })().catch(() => rejectUpgrade(socket, 500, "Internal Server Error"));
  };

  app.server.on("upgrade", handleUpgrade);
  app.addHook("onClose", async () => {
    app.server.off("upgrade", handleUpgrade);
    for (const client of webSocketServer.clients) client.terminate();
    await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
  });
}

function handleRealtimeClient(client: WebSocket, asr: AsrService): void {
  let session: Awaited<ReturnType<AsrService["openRealtime"]>> | null = null;
  let starting = false;
  let closed = false;
  let audioFrameCount = 0;
  let audioByteCount = 0;
  let transcriptEventCount = 0;
  const startTimeout = setTimeout(() => {
    sendRealtimeEvent(client, { type: "error", code: "invalid_argument", message: "Real-time ASR start message timed out" });
    client.close(1008, "start timeout");
  }, REALTIME_START_TIMEOUT_MS);

  client.on("message", (data, isBinary) => {
    if (isBinary) {
      if (session) {
        const audio = rawDataBytes(data);
        audioFrameCount += 1;
        audioByteCount += audio.byteLength;
        if (audioFrameCount === 1) {
          console.info(`[asr-realtime] received first PCM frame (${audio.byteLength} bytes)`);
        }
        session.sendAudio(audio);
      }
      return;
    }
    const message = parseClientMessage(data);
    if (!message) {
      sendRealtimeEvent(client, { type: "error", code: "invalid_argument", message: "Invalid real-time ASR message" });
      return;
    }
    if (message.type === "start") {
      if (starting || session) return;
      starting = true;
      clearTimeout(startTimeout);
      console.info(`[asr-realtime] opening upstream session at ${message.sampleRate} Hz`);
      void asr.openRealtime({
        sampleRate: message.sampleRate,
        ...(message.languageHints ? { languageHints: message.languageHints } : {}),
        onTranscript: (event) => {
          transcriptEventCount += 1;
          console.info(
            `[asr-realtime] transcript event #${transcriptEventCount} sentence=${event.sentenceId} final=${event.final} chars=${event.text.length}`
          );
          sendRealtimeEvent(client, event);
        },
        onError: (error) => {
          sendRealtimeEvent(client, errorEvent(error));
          client.close(1011, "upstream error");
        }
      }).then((opened) => {
        if (closed) {
          opened.close();
          return;
        }
        session = opened;
        console.info(`[asr-realtime] upstream task ready (${opened.modelId})`);
        sendRealtimeEvent(client, {
          type: "ready",
          taskId: opened.taskId,
          modelId: QWEN_ASR_REALTIME_MODEL_ID
        });
      }).catch((error) => {
        sendRealtimeEvent(client, errorEvent(error));
        client.close(1011, "start failed");
      });
      return;
    }
    if (!session) {
      sendRealtimeEvent(client, { type: "error", code: "invalid_argument", message: "Real-time ASR is not ready" });
      return;
    }
    void session.finish().then(() => {
      console.info(
        `[asr-realtime] upstream task finished frames=${audioFrameCount} bytes=${audioByteCount} transcripts=${transcriptEventCount}`
      );
      sendRealtimeEvent(client, { type: "finished", taskId: session?.taskId ?? "unknown" });
      client.close(1000, "finished");
    }).catch((error) => {
      sendRealtimeEvent(client, errorEvent(error));
      client.close(1011, "finish failed");
    });
  });

  client.on("close", () => {
    closed = true;
    clearTimeout(startTimeout);
    session?.close();
    if (audioFrameCount > 0 || transcriptEventCount > 0) {
      console.info(
        `[asr-realtime] local client closed frames=${audioFrameCount} bytes=${audioByteCount} transcripts=${transcriptEventCount}`
      );
    }
  });
  client.on("error", () => {
    closed = true;
    clearTimeout(startTimeout);
    session?.close();
  });
}

function parseClientMessage(data: RawData) {
  try {
    return AsrRealtimeClientMessageSchema.parse(JSON.parse(rawDataText(data)) as unknown);
  } catch {
    return null;
  }
}

function sendRealtimeEvent(client: WebSocket, event: AsrRealtimeServerEvent): void {
  if (client.readyState !== WebSocket.OPEN) return;
  client.send(JSON.stringify(AsrRealtimeServerEventSchema.parse(event)));
}

function errorEvent(error: unknown): AsrRealtimeServerEvent {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const code = typeof (normalized as Error & { code?: unknown }).code === "string"
    ? (normalized as Error & { code: string }).code
    : undefined;
  return {
    type: "error",
    ...(code ? { code } : {}),
    message: normalized.message || "Real-time ASR failed"
  };
}

function rawDataText(data: RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data as ArrayBuffer).toString("utf8");
}

function rawDataBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Uint8Array.from(Buffer.concat(data));
  return Uint8Array.from(Buffer.from(data as ArrayBuffer));
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  if (socket.destroyed) return;
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
