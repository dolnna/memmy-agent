/** DashScope speaker-diarized file transcription adapter. */
import type {
  AsrTranscriptSegment,
  AsrTranscriptionInput,
  ResolvedProviderSnapshot
} from "@memmy/local-api-contracts";

export const DASHSCOPE_DIARIZED_ASR_MODEL = "qwen-audio-3.0-asr-flash-filetrans";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 30 * 60 * 1_000;

export interface DashScopeFileTranscriptionResult {
  text: string;
  segments: AsrTranscriptSegment[];
}

export interface DashScopeFileTranscriptionOptions {
  input: AsrTranscriptionInput;
  provider: Readonly<ResolvedProviderSnapshot>;
  fetch: typeof fetch;
  sleep?: (durationMs: number) => Promise<void>;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Uploads audio to DashScope temporary OSS, runs an asynchronous diarized ASR task,
 * and downloads the structured transcript.
 */
export async function transcribeDashScopeFile(
  options: DashScopeFileTranscriptionOptions
): Promise<DashScopeFileTranscriptionResult> {
  const apiKey = options.provider.apiKey;
  if (!apiKey) {
    throw asrError("DashScope ASR API key is not configured", "unauthorized");
  }

  const apiBase = toDashScopeApiV1Base(options.provider.apiBase);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TRANSCRIPTION_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    ...options.provider.extraHeaders
  };
  const fileName = safeAudioFileName(options.input.fileName, options.input.mimeType);
  const ossUrl = await uploadTemporaryAudio({
    fetch: options.fetch,
    apiBase,
    headers,
    fileName,
    mimeType: options.input.mimeType,
    audioBase64: options.input.audioBase64,
    signal
  });
  const taskId = await submitTranscriptionTask({
    fetch: options.fetch,
    apiBase,
    headers,
    ossUrl,
    speakerCount: options.input.speakerCount,
    signal
  });
  const transcriptionUrl = await waitForTranscription({
    fetch: options.fetch,
    apiBase,
    headers,
    taskId,
    sleep: options.sleep ?? defaultSleep,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    timeoutMs,
    signal
  });
  // The signed result URL is fetched without provider Authorization headers.
  const transcription = await requestJson(options.fetch, transcriptionUrl, { method: "GET", signal });
  const parsed = parseDashScopeTranscription(transcription);
  if (!parsed.text.trim()) throw asrError("DashScope ASR transcription is empty", "internal");
  return parsed;
}

interface UploadTemporaryAudioOptions {
  fetch: typeof fetch;
  apiBase: string;
  headers: Record<string, string>;
  fileName: string;
  mimeType: string;
  audioBase64: string;
  signal: AbortSignal;
}

async function uploadTemporaryAudio(options: UploadTemporaryAudioOptions): Promise<string> {
  const policyUrl = new URL(`${options.apiBase}/uploads`);
  policyUrl.searchParams.set("action", "getPolicy");
  policyUrl.searchParams.set("model", DASHSCOPE_DIARIZED_ASR_MODEL);
  const policyResponse = await requestJson(options.fetch, policyUrl, {
    method: "GET",
    headers: {
      ...options.headers,
      "content-type": "application/json"
    },
    signal: options.signal
  });
  const policy = requireRecord(asRecord(policyResponse).data, "DashScope upload policy is missing data");
  const uploadHost = requireString(policy.upload_host, "DashScope upload policy is missing upload_host");
  const uploadDirectory = requireString(policy.upload_dir, "DashScope upload policy is missing upload_dir");
  const audioBytes = Uint8Array.from(Buffer.from(options.audioBase64, "base64"));
  const maxFileSizeMb = positiveNumber(policy.max_file_size_mb);
  if (maxFileSizeMb !== null && audioBytes.byteLength > maxFileSizeMb * 1024 * 1024) {
    throw asrError(`Audio exceeds DashScope upload limit of ${maxFileSizeMb} MB`, "invalid_argument");
  }
  const objectKey = `${uploadDirectory.replace(/\/+$/u, "")}/${options.fileName}`;
  const form = new FormData();
  form.append("OSSAccessKeyId", requireString(policy.oss_access_key_id, "DashScope upload policy is missing oss_access_key_id"));
  form.append("Signature", requireString(policy.signature, "DashScope upload policy is missing signature"));
  form.append("policy", requireString(policy.policy, "DashScope upload policy is missing policy"));
  form.append("x-oss-object-acl", requireString(policy.x_oss_object_acl, "DashScope upload policy is missing x_oss_object_acl"));
  form.append("x-oss-forbid-overwrite", requireString(policy.x_oss_forbid_overwrite, "DashScope upload policy is missing x_oss_forbid_overwrite"));
  form.append("key", objectKey);
  form.append("success_action_status", "200");
  form.append(
    "file",
    new Blob([audioBytes], { type: options.mimeType }),
    options.fileName
  );

  ensureBeforeDeadline(options.signal);
  const uploadResponse = await options.fetch(uploadHost, { method: "POST", body: form, signal: options.signal });
  if (!uploadResponse.ok) {
    throw await responseError(uploadResponse, "DashScope temporary audio upload failed");
  }
  return `oss://${objectKey}`;
}

interface SubmitTranscriptionTaskOptions {
  fetch: typeof fetch;
  apiBase: string;
  headers: Record<string, string>;
  ossUrl: string;
  speakerCount?: number;
  signal: AbortSignal;
}

async function submitTranscriptionTask(options: SubmitTranscriptionTaskOptions): Promise<string> {
  const parameters: Record<string, unknown> = {
    diarization_enabled: true,
    channel_id: [0],
    language_hints: ["zh", "en"]
  };
  if (options.speakerCount !== undefined) parameters.speaker_count = options.speakerCount;
  const response = await requestJson(options.fetch, `${options.apiBase}/services/audio/asr/transcription`, {
    method: "POST",
    headers: {
      ...options.headers,
      "content-type": "application/json",
      "X-DashScope-Async": "enable",
      "X-DashScope-OssResourceResolve": "enable"
    },
    body: JSON.stringify({
      model: DASHSCOPE_DIARIZED_ASR_MODEL,
      input: { file_urls: [options.ossUrl] },
      parameters
    }),
    signal: options.signal
  });
  const output = requireRecord(asRecord(response).output, "DashScope ASR task response is missing output");
  const status = requireString(output.task_status, "DashScope ASR task response is missing task_status").toUpperCase();
  if (status !== "PENDING") {
    throw asrError(readErrorMessage(output) ?? `DashScope ASR task submission returned ${status}`, "internal");
  }
  return requireString(output.task_id, "DashScope ASR task response is missing task_id");
}

interface WaitForTranscriptionOptions {
  fetch: typeof fetch;
  apiBase: string;
  headers: Record<string, string>;
  taskId: string;
  sleep: (durationMs: number) => Promise<void>;
  pollIntervalMs: number;
  timeoutMs: number;
  signal: AbortSignal;
}

async function waitForTranscription(options: WaitForTranscriptionOptions): Promise<string> {
  const pollIntervalMs = Math.max(1, options.pollIntervalMs);
  const maxAttempts = Math.max(1, Math.ceil(options.timeoutMs / pollIntervalMs));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    ensureBeforeDeadline(options.signal);
    if (attempt > 0) {
      await options.sleep(pollIntervalMs);
      ensureBeforeDeadline(options.signal);
    }
    const response = await requestJson(
      options.fetch,
      `${options.apiBase}/tasks/${encodeURIComponent(options.taskId)}`,
      { method: "GET", headers: options.headers, signal: options.signal }
    );
    const output = requireRecord(asRecord(response).output, "DashScope ASR task response is missing output");
    const status = requireString(output.task_status, "DashScope ASR task response is missing task_status").toUpperCase();
    if (status === "SUCCEEDED") {
      const results = Array.isArray(output.results) ? output.results : [];
      const succeeded = results
        .map(asRecord)
        .find((result) => String(result.subtask_status ?? "").toUpperCase() === "SUCCEEDED");
      if (!succeeded) {
        const failed = results.map(asRecord).find((result) => String(result.subtask_status ?? "").toUpperCase() !== "SUCCEEDED");
        throw asrError(readErrorMessage(failed ?? output) ?? "DashScope ASR task has no successful subtask", "internal");
      }
      return requireString(succeeded.transcription_url, "DashScope ASR task is missing transcription_url");
    }
    if (status === "PENDING" || status === "RUNNING") continue;
    if (status === "FAILED" || status === "UNKNOWN") {
      throw asrError(readErrorMessage(output) ?? `DashScope ASR task ${status.toLowerCase()}`, "internal");
    }
    throw asrError(`DashScope ASR task returned unsupported status ${status}`, "internal");
  }
  throw asrError("DashScope ASR task timed out", "internal");
}

/** Parses the downloaded DashScope transcript into the local canonical shape. */
export function parseDashScopeTranscription(value: unknown): DashScopeFileTranscriptionResult {
  const root = asRecord(value);
  const transcripts = Array.isArray(root.transcripts)
    ? root.transcripts
    : Array.isArray(asRecord(root.output).transcripts)
      ? asRecord(root.output).transcripts as unknown[]
      : [];
  const segments: AsrTranscriptSegment[] = [];
  const transcriptTexts: string[] = [];

  transcripts.forEach((transcriptValue, transcriptIndex) => {
    const transcript = asRecord(transcriptValue);
    const transcriptText = readString(transcript.text);
    if (transcriptText) transcriptTexts.push(transcriptText);
    const sentences = Array.isArray(transcript.sentences) ? transcript.sentences : [];
    sentences.forEach((sentenceValue, sentenceIndex) => {
      const sentence = asRecord(sentenceValue);
      const text = readString(sentence.text) ?? "";
      const startMs = nonNegativeInteger(sentence.begin_time) ?? 0;
      const endMs = Math.max(startMs, nonNegativeInteger(sentence.end_time) ?? startMs);
      const speakerId = nonNegativeInteger(sentence.speaker_id);
      const words = (Array.isArray(sentence.words) ? sentence.words : []).map(asRecord).map((word) => {
        const wordStartMs = nonNegativeInteger(word.begin_time) ?? startMs;
        const punctuation = typeof word.punctuation === "string" ? word.punctuation : undefined;
        return {
          text: readString(word.text) ?? "",
          startMs: wordStartMs,
          endMs: Math.max(wordStartMs, nonNegativeInteger(word.end_time) ?? wordStartMs),
          ...(punctuation === undefined ? {} : { punctuation })
        };
      });
      const sentenceId = typeof sentence.sentence_id === "string" || typeof sentence.sentence_id === "number"
        ? String(sentence.sentence_id)
        : String(sentenceIndex + 1);
      segments.push({
        id: `segment-${transcriptIndex + 1}-${sentenceId}`,
        speakerId,
        startMs,
        endMs,
        text,
        words
      });
    });
  });

  const text = transcriptTexts.join("\n").trim() || segments.map((segment) => segment.text).filter(Boolean).join("\n");
  return { text, segments };
}

/** Converts an OpenAI-compatible DashScope base URL to the native /api/v1 root. */
export function toDashScopeApiV1Base(apiBase: string): string {
  const url = new URL(apiBase);
  url.search = "";
  url.hash = "";
  const path = url.pathname.replace(/\/+$/u, "");
  url.pathname = path.endsWith("/compatible-mode/v1")
    ? `${path.slice(0, -"/compatible-mode/v1".length)}/api/v1`
    : path.endsWith("/api/v1")
      ? path
      : `${path}/api/v1`;
  return url.toString().replace(/\/+$/u, "");
}

async function requestJson(fetchImpl: typeof fetch, input: string | URL, init: RequestInit): Promise<unknown> {
  if (init.signal instanceof AbortSignal) ensureBeforeDeadline(init.signal);
  const response = await fetchImpl(input, init);
  if (!response.ok) throw await responseError(response, "DashScope ASR request failed");
  try {
    return await response.json();
  } catch {
    throw asrError("DashScope ASR response is not valid JSON", "internal");
  }
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  let value: unknown = null;
  try {
    value = await response.json();
  } catch {
    // Keep the fallback when the upstream body is not JSON.
  }
  return asrError(readErrorMessage(asRecord(value)) ?? `${fallback} with HTTP ${response.status}`, classifyStatus(response.status));
}

function safeAudioFileName(fileName: string | undefined, mimeType: string): string {
  const requested = fileName?.split(/[\\/]/u).pop()?.replace(/[\0\r\n]/gu, "").trim();
  if (requested) return requested;
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("wav")) return "recording.wav";
  if (normalized.includes("mpeg")) return "recording.mp3";
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "recording.m4a";
  if (normalized.includes("ogg")) return "recording.ogg";
  return "recording.webm";
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw asrError(message, "internal");
}

function requireString(value: unknown, message: string): string {
  if (typeof value === "string" && value.trim()) return value;
  throw asrError(message, "internal");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function positiveNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readErrorMessage(value: Record<string, unknown>): string | null {
  const error = asRecord(value.error);
  const message = readString(error.message) ?? readString(value.message);
  const rawCode = error.code ?? value.code;
  const code = typeof rawCode === "string" || typeof rawCode === "number" ? String(rawCode) : null;
  if (message && code) return `${message} (${code})`;
  return message ?? code;
}

function ensureBeforeDeadline(signal: AbortSignal): void {
  if (signal.aborted) throw asrError("DashScope ASR task timed out", "internal");
}

function classifyStatus(status: number): "invalid_argument" | "unauthorized" | "forbidden" | "rate_limited" | "internal" {
  if (status === 400 || status === 422) return "invalid_argument";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  return "internal";
}

function asrError(message: string, code: "invalid_argument" | "unauthorized" | "forbidden" | "rate_limited" | "internal"): Error {
  return Object.assign(new Error(message), { code });
}

function defaultSleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
