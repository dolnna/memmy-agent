import { useCallback, useEffect, useRef, useState } from "react";
import {
  ASR_REALTIME_SAMPLE_RATE,
  type AsrRealtimeTranscriptEvent,
  type AsrTranscriptionInput,
  type AsrTranscriptionResponse
} from "@memmy/local-api-contracts";
import type { AsrClient } from "../api/asr-client.js";
import { formatMessage, type MessageKey, zhCNMessages } from "../i18n/messages.js";

const EMPTY_AUDIO_ERROR_MESSAGE = formatMessage(zhCNMessages["asr.error.emptyAudio"]);
const MICROPHONE_PERMISSION_ERROR_MESSAGE = formatMessage(zhCNMessages["asr.error.microphonePermissionDenied"]);

export type AsrRecorderStatus = "idle" | "checkingPermission" | "requestingPermission" | "starting" | "recording" | "paused" | "transcribing" | "error";
export type MicrophoneAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unsupported";

export interface AsrRecorder {
  status: AsrRecorderStatus;
  error: Error | null;
  isRecording: boolean;
  isTranscribing: boolean;
  isStarting: boolean;
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  cancel(): void;
  finishAndTranscribe(): Promise<AsrTranscriptionResponse>;
}

export interface EncodedAudio {
  audioBase64: string;
  mimeType: string;
}

export interface AsrRecorderOptions {
  emptyAudioMessage?: string;
  onAudioCaptured?: (audio: { blob: Blob; mimeType: string; durationMs?: number; recordedAt: string }) => void;
  transcribeOptions?: AsrRecorderTranscribeOptions;
  realtime?: AsrRecorderRealtimeOptions;
}

export interface AsrRecorderRealtimeOptions {
  enabled: boolean;
  languageHints?: string[];
  onTranscript: (event: AsrRealtimeTranscriptEvent) => void;
  onError?: (error: Error) => void;
}

export type AsrRecorderTranscribeOptions = Omit<
  AsrTranscriptionInput,
  "audioBase64" | "mimeType" | "durationMs"
>;

export interface MicrophoneAccessBridge {
  getMicrophoneAccessStatus(): Promise<MicrophoneAccessStatus>;
  requestMicrophoneAccess(): Promise<MicrophoneAccessStatus>;
}

export class MicrophonePermissionError extends Error {
  readonly status: MicrophoneAccessStatus;

  constructor(status: MicrophoneAccessStatus, message = MICROPHONE_PERMISSION_ERROR_MESSAGE) {
    super(message);
    this.name = "MicrophonePermissionError";
    this.status = status;
  }
}

/**
 * Resolves the toast/copy key that guides the user to the OS microphone settings page.
 *
 * macOS and Windows use different Settings paths, so the key is platform-aware.
 *
 * @param platform The desktop runtime platform (`darwin`, `win32`, …).
 * @returns A message key that can be translated for the current OS.
 */
export function microphonePermissionDeniedMessageKey(
  platform: string | undefined = typeof window === "undefined" ? undefined : window.memmy?.platform
): MessageKey {
  return platform === "win32"
    ? "asr.error.microphonePermissionDenied.windows"
    : "asr.error.microphonePermissionDenied.mac";
}

export function useAsrRecorder(asrClient?: AsrClient, options: AsrRecorderOptions = {}): AsrRecorder {
  const emptyAudioMessage = options.emptyAudioMessage;
  const onAudioCaptured = options.onAudioCaptured;
  const diarizationEnabled = options.transcribeOptions?.diarizationEnabled;
  const fileName = options.transcribeOptions?.fileName;
  const speakerCount = options.transcribeOptions?.speakerCount;
  const realtimeEnabled = options.realtime?.enabled === true;
  const realtimeLanguageHints = options.realtime?.languageHints;
  const onRealtimeTranscript = options.realtime?.onTranscript;
  const onRealtimeError = options.realtime?.onError;
  const [status, setStatus] = useState<AsrRecorderStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const realtimeCaptureRef = useRef<RealtimeAudioCapture | null>(null);

  const cancel = useCallback(() => {
    stopRecorderSilently(recorderRef.current);
    recorderRef.current = null;
    chunksRef.current = [];
    startedAtRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    void realtimeCaptureRef.current?.close();
    realtimeCaptureRef.current = null;
    setStatus("idle");
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = useCallback(async () => {
    cancel();
    setError(null);

    try {
      if (!asrClient) {
        throw new Error("ASR client is not configured");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone recording is not supported");
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("MediaRecorder is not supported");
      }

      setStatus("checkingPermission");
      await ensureMicrophoneAccess(getMicrophoneAccessBridge(), (status) => {
        if (status === "requestingPermission") {
          setStatus("requestingPermission");
        }
      });
      setStatus("starting");
      let stream: MediaStream;
      try {
        stream = await getMonoMicrophoneStream(navigator.mediaDevices);
      } catch (mediaError) {
        if (isMicrophonePermissionDenial(mediaError)) {
          throw new MicrophonePermissionError("denied");
        }
        throw mediaError;
      }
      const recorder = new MediaRecorder(stream, pickRecorderOptions());
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      if (realtimeEnabled && onRealtimeTranscript) {
        try {
          realtimeCaptureRef.current = await startRealtimeAudioCapture({
            asrClient,
            stream,
            onTranscript: onRealtimeTranscript,
            ...(onRealtimeError ? { onError: onRealtimeError } : {}),
            ...(realtimeLanguageHints ? { languageHints: realtimeLanguageHints } : {})
          });
        } catch (realtimeError) {
          onRealtimeError?.(realtimeError instanceof Error ? realtimeError : new Error(String(realtimeError)));
        }
      }
      recorder.start();
      startedAtRef.current = Date.now();
      setStatus("recording");
    } catch (caught) {
      const nextError = caught instanceof Error ? caught : new Error(String(caught));
      stopRecorderSilently(recorderRef.current);
      recorderRef.current = null;
      chunksRef.current = [];
      startedAtRef.current = null;
      stopStream(streamRef.current);
      streamRef.current = null;
      setError(nextError);
      setStatus("error");
      throw nextError;
    }
  }, [asrClient, cancel, onRealtimeError, onRealtimeTranscript, realtimeEnabled, realtimeLanguageHints]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.pause();
    realtimeCaptureRef.current?.pause();
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    recorder.resume();
    realtimeCaptureRef.current?.resume();
    setStatus("recording");
  }, []);

  const finishAndTranscribe = useCallback(async () => {
    if (!asrClient) {
      throw new Error("ASR client is not configured");
    }

    const recorder = recorderRef.current;
    if (!recorder) {
      throw new Error("No active recording");
    }

    try {
      setStatus("transcribing");
      const endedAtMs = Date.now();
      const recordingStartedAtMs = startedAtRef.current;
      const durationMs = recordingStartedAtMs ? Math.max(0, endedAtMs - recordingStartedAtMs) : undefined;
      const realtimeCapture = realtimeCaptureRef.current;
      realtimeCaptureRef.current = null;
      await realtimeCapture?.finish().catch((realtimeError: unknown) => {
        onRealtimeError?.(realtimeError instanceof Error ? realtimeError : new Error(String(realtimeError)));
      });
      const blob = await stopRecorder(recorder, chunksRef.current);
      if (blob.size > 0) {
        onAudioCaptured?.({
          blob,
          mimeType: blob.type || recorder.mimeType || "audio/webm",
          recordedAt: new Date(recordingStartedAtMs ?? endedAtMs).toISOString(),
          ...(durationMs === undefined ? {} : { durationMs })
        });
      }
      chunksRef.current = [];
      recorderRef.current = null;
      stopStream(streamRef.current);
      streamRef.current = null;
      startedAtRef.current = null;
      const encoded = await blobToAudioBase64(blob, emptyAudioMessage);
      const transcribeInput: AsrTranscriptionInput & AsrRecorderTranscribeOptions = {
        audioBase64: encoded.audioBase64,
        mimeType: encoded.mimeType,
        durationMs,
        ...(diarizationEnabled === undefined ? {} : { diarizationEnabled }),
        ...(fileName ? { fileName } : {}),
        ...(speakerCount === undefined ? {} : { speakerCount })
      };
      const result = await asrClient.transcribe(transcribeInput);
      setStatus("idle");
      return result;
    } catch (caught) {
      const nextError = caught instanceof Error ? caught : new Error(String(caught));
      setError(nextError);
      setStatus("error");
      stopStream(streamRef.current);
      streamRef.current = null;
      throw nextError;
    }
  }, [asrClient, diarizationEnabled, emptyAudioMessage, fileName, onAudioCaptured, onRealtimeError, speakerCount]);

  return {
    status,
    error,
    isRecording: status === "recording" || status === "paused",
    isTranscribing: status === "transcribing",
    isStarting: status === "checkingPermission" || status === "requestingPermission" || status === "starting",
    start,
    pause,
    resume,
    cancel,
    finishAndTranscribe
  };
}

interface RealtimeAudioCapture {
  pause(): void;
  resume(): void;
  finish(): Promise<void>;
  close(): Promise<void>;
}

interface StartRealtimeAudioCaptureOptions {
  asrClient: AsrClient;
  stream: MediaStream;
  languageHints?: string[];
  onTranscript: (event: AsrRealtimeTranscriptEvent) => void;
  onError?: (error: Error) => void;
}

async function startRealtimeAudioCapture(
  options: StartRealtimeAudioCaptureOptions
): Promise<RealtimeAudioCapture> {
  const session = await options.asrClient.startRealtime({
    ...(options.languageHints ? { languageHints: options.languageHints } : {}),
    onTranscript: options.onTranscript,
    ...(options.onError ? { onError: options.onError } : {})
  });
  console.info("[asr-realtime] renderer session ready");
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch (error) {
    session.close();
    throw error;
  }
  if (context.state === "suspended") await context.resume();
  const source = context.createMediaStreamSource(options.stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silentOutput = context.createGain();
  silentOutput.gain.value = 0;
  let paused = false;
  let stopped = false;
  let frameCount = 0;
  processor.onaudioprocess = (event) => {
    if (paused || stopped) return;
    const samples = event.inputBuffer.getChannelData(0);
    const pcm = resampleToPcm16(samples, context.sampleRate, ASR_REALTIME_SAMPLE_RATE);
    frameCount += 1;
    if (frameCount === 1) {
      console.info(
        `[asr-realtime] renderer first PCM frame inputRate=${context.sampleRate} outputRate=${ASR_REALTIME_SAMPLE_RATE} bytes=${pcm.byteLength}`
      );
    }
    session.sendAudio(pcm);
  };
  source.connect(processor);
  processor.connect(silentOutput);
  silentOutput.connect(context.destination);

  const disconnect = async () => {
    if (stopped) return;
    stopped = true;
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    silentOutput.disconnect();
    await context.close().catch(() => undefined);
  };

  return {
    pause() { paused = true; },
    resume() { paused = false; },
    async finish() {
      await disconnect();
      await session.finish();
    },
    async close() {
      await disconnect();
      session.close();
    }
  };
}

/** Resamples Web Audio float samples and encodes signed 16-bit little-endian PCM. */
export function resampleToPcm16(samples: Float32Array, inputRate: number, outputRate: number): Uint8Array {
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate) || inputRate <= 0 || outputRate <= 0) {
    return new Uint8Array();
  }
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(0, Math.floor(samples.length / ratio));
  const buffer = new ArrayBuffer(outputLength * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < outputLength; index += 1) {
    const start = index * ratio;
    const end = Math.min(samples.length, (index + 1) * ratio);
    let value = 0;
    if (ratio >= 1) {
      const first = Math.floor(start);
      const last = Math.max(first + 1, Math.ceil(end));
      for (let sampleIndex = first; sampleIndex < last && sampleIndex < samples.length; sampleIndex += 1) {
        value += samples[sampleIndex] ?? 0;
      }
      value /= Math.max(1, Math.min(last, samples.length) - first);
    } else {
      const left = Math.floor(start);
      const right = Math.min(samples.length - 1, left + 1);
      const fraction = start - left;
      value = (samples[left] ?? 0) * (1 - fraction) + (samples[right] ?? 0) * fraction;
    }
    const clamped = Math.max(-1, Math.min(1, value));
    view.setInt16(index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

async function getMonoMicrophoneStream(mediaDevices: MediaDevices): Promise<MediaStream> {
  try {
    return await mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  } catch (error) {
    if (!isMonoChannelConstraintUnsupported(error)) throw error;
    return mediaDevices.getUserMedia({ audio: true });
  }
}

function isMonoChannelConstraintUnsupported(error: unknown): boolean {
  if (!(error instanceof DOMException) && !(error instanceof Error)) return false;
  return error.name === "OverconstrainedError" || /channel\s*count|channelCount/i.test(error.message);
}

export async function ensureMicrophoneAccess(
  bridge?: Partial<MicrophoneAccessBridge>,
  onTransition?: (status: "requestingPermission") => void
): Promise<MicrophoneAccessStatus> {
  if (!bridge?.getMicrophoneAccessStatus || !bridge.requestMicrophoneAccess) {
    return "granted";
  }

  const currentStatus = normalizeMicrophoneAccessStatus(await bridge.getMicrophoneAccessStatus());
  if (currentStatus === "granted") {
    return "granted";
  }
  if (currentStatus === "restricted" || currentStatus === "unsupported") {
    throw new MicrophonePermissionError(currentStatus);
  }

  onTransition?.("requestingPermission");
  const requestedStatus = normalizeMicrophoneAccessStatus(await bridge.requestMicrophoneAccess());
  if (requestedStatus === "granted") {
    return "granted";
  }
  // Windows/Linux prompt via getUserMedia; leave not-determined so the recorder can continue.
  if (requestedStatus === "not-determined") {
    return "not-determined";
  }

  throw new MicrophonePermissionError(requestedStatus);
}

/**
 * Detects browser/OS denials from getUserMedia that should surface as a microphone-permission toast.
 *
 * @param error The rejection from getUserMedia.
 * @returns True when the user (or OS policy) blocked microphone access.
 */
export function isMicrophonePermissionDenial(error: unknown): boolean {
  if (!(error instanceof DOMException) && !(error instanceof Error)) {
    return false;
  }
  const name = error.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return true;
  }
  return /permission|not allowed|denied/i.test(error.message);
}

export async function blobToAudioBase64(blob: Blob, emptyAudioMessage = EMPTY_AUDIO_ERROR_MESSAGE): Promise<EncodedAudio> {
  if (blob.size <= 0) {
    throw new Error(emptyAudioMessage);
  }

  const dataUrl = await readBlobAsDataUrl(blob);
  const encoded = parseAudioDataUrl(dataUrl, blob.type);
  if (!encoded.audioBase64.trim()) {
    throw new Error(emptyAudioMessage);
  }
  return encoded;
}

export function mergeVoiceTranscript(current: string, transcript: string): string {
  const next = transcript.trim();
  if (!next) return current;
  const existing = current.trim();
  return existing ? `${existing}\n${next}` : next;
}

/**
 * Picks a recording format supported by the browser.
 *
 * @returns The MediaRecorder init options.
 */
function pickRecorderOptions(): MediaRecorderOptions {
  const candidates = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  return mimeType ? { mimeType } : {};
}

/**
 * Reads the microphone-permission bridge exposed by the Electron preload.
 *
 * @returns The currently available permission bridge; undefined when debugging in a plain browser.
 */
function getMicrophoneAccessBridge(): MicrophoneAccessBridge | undefined {
  const bridge = typeof window === "undefined" ? undefined : window.memmy;
  if (
    typeof bridge?.getMicrophoneAccessStatus === "function"
    && typeof bridge.requestMicrophoneAccess === "function"
  ) {
    return {
      getMicrophoneAccessStatus: bridge.getMicrophoneAccessStatus,
      requestMicrophoneAccess: bridge.requestMicrophoneAccess
    };
  }
  return undefined;
}

/**
 * Normalizes the microphone-permission status passed in from outside.
 *
 * @param status The permission status returned by the preload or a test double.
 * @returns A stable permission status used internally by the hook.
 */
function normalizeMicrophoneAccessStatus(status: unknown): MicrophoneAccessStatus {
  if (
    status === "not-determined"
    || status === "granted"
    || status === "denied"
    || status === "restricted"
    || status === "unsupported"
  ) {
    return status;
  }
  return "unsupported";
}

/**
 * Stops recording and produces a Blob.
 *
 * @param recorder The current MediaRecorder.
 * @param chunks The audio chunks collected so far.
 * @returns The complete recording Blob.
 */
function stopRecorder(recorder: MediaRecorder, chunks: Blob[]): Promise<Blob> {
  return new Promise((resolve) => {
    const mimeType = recorder.mimeType || chunks[0]?.type || "audio/webm";
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
    if (recorder.state === "inactive") {
      resolve(new Blob(chunks, { type: mimeType }));
      return;
    }
    requestRecorderData(recorder);
    recorder.stop();
  });
}

/**
 * Actively flushes the browser recording buffer.
 *
 * @param recorder The current MediaRecorder.
 */
function requestRecorderData(recorder: MediaRecorder): void {
  if (recorder.state === "inactive") return;
  try {
    recorder.requestData();
  } catch {
    // Some browsers reject requestData around stop; the subsequent empty-Blob check surfaces a readable error.
  }
}

/**
 * Silently stops recording.
 *
 * @param recorder The current MediaRecorder.
 */
function stopRecorderSilently(recorder: MediaRecorder | null): void {
  if (!recorder || recorder.state === "inactive") return;
  try {
    recorder.stop();
  } catch {
    // Do not expose browser stop exceptions to the page when canceling a recording.
  }
}

/**
 * Releases the microphone media stream.
 *
 * @param stream The current media stream.
 */
function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

/**
 * Parses the audio data URL produced by FileReader.
 *
 * @param dataUrl The data URL output by FileReader.
 * @param fallbackMimeType The MIME type carried by the Blob itself.
 * @returns The base64 audio and MIME type.
 */
function parseAudioDataUrl(dataUrl: string, fallbackMimeType: string): EncodedAudio {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    return {
      audioBase64: "",
      mimeType: fallbackMimeType || "audio/webm"
    };
  }

  const header = dataUrl.slice(0, commaIndex);
  const mimeType = header.startsWith("data:") ? header.slice("data:".length).split(";")[0] : "";
  return {
    audioBase64: dataUrl.slice(commaIndex + 1),
    mimeType: mimeType || fallbackMimeType || "audio/webm"
  };
}

/**
 * Reads a Blob as a data URL.
 *
 * @param blob The browser recording Blob.
 * @returns The data URL.
 */
function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read audio blob"));
    reader.readAsDataURL(blob);
  });
}
