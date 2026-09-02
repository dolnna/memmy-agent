/** DashScope speaker-diarized file transcription adapter tests. */
import { describe, expect, it } from "vitest";
import {
  DASHSCOPE_DIARIZED_ASR_MODEL,
  parseDashScopeTranscription,
  toDashScopeApiV1Base,
  transcribeDashScopeFile
} from "../dashscope-file-transcription.js";

describe("DashScope diarized file transcription", () => {
  it("uploads audio, submits and polls the async task, then returns canonical speaker segments", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let pollCount = 0;
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = input.toString();
      calls.push({ url, init });
      if (url.includes("/uploads?")) {
        return json({
          data: {
            policy: "policy-value",
            signature: "signature-value",
            upload_dir: "dashscope-instant/account/date/task",
            upload_host: "https://temporary-oss.example.test",
            max_file_size_mb: "1",
            oss_access_key_id: "oss-key",
            x_oss_object_acl: "private",
            x_oss_forbid_overwrite: "true"
          }
        });
      }
      if (url === "https://temporary-oss.example.test") return new Response(null, { status: 200 });
      if (url.endsWith("/services/audio/asr/transcription")) {
        return json({ output: { task_id: "task-1", task_status: "PENDING" } });
      }
      if (url.endsWith("/tasks/task-1")) {
        pollCount += 1;
        return pollCount === 1
          ? json({ output: { task_id: "task-1", task_status: "RUNNING" } })
          : json({
              output: {
                task_id: "task-1",
                task_status: "SUCCEEDED",
                results: [{ subtask_status: "SUCCEEDED", transcription_url: "https://result.example.test/transcript.json" }]
              }
            });
      }
      if (url === "https://result.example.test/transcript.json") {
        return json({
          transcripts: [{
            text: "您好。\n我们开始吧。",
            sentences: [
              {
                begin_time: 100,
                end_time: 900,
                sentence_id: 7,
                text: "您好。",
                speaker_id: 0,
                words: [{ text: "您好", begin_time: 100, end_time: 800, punctuation: "。" }]
              },
              {
                begin_time: 1_000,
                end_time: 2_100,
                sentence_id: 8,
                text: "我们开始吧。",
                speaker_id: 1,
                words: [{ text: "开始", begin_time: 1_300, end_time: 1_800 }]
              }
            ]
          }]
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const result = await transcribeDashScopeFile({
      input: {
        audioBase64: Buffer.from("audio-bytes").toString("base64"),
        mimeType: "audio/webm",
        fileName: "客户访谈.webm",
        diarizationEnabled: true,
        speakerCount: 2
      },
      provider: {
        provider: "dashscope",
        endpointId: "asr",
        protocol: "dashscope-input-audio-chat",
        apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "secret-key",
        extraHeaders: {},
        extraBody: {}
      },
      fetch: fetchImpl,
      sleep: async () => undefined,
      pollIntervalMs: 1,
      timeoutMs: 1_000
    });

    expect(result).toEqual({
      text: "您好。\n我们开始吧。",
      segments: [
        {
          id: "segment-1-7",
          speakerId: 0,
          startMs: 100,
          endMs: 900,
          text: "您好。",
          words: [{ text: "您好", startMs: 100, endMs: 800, punctuation: "。" }]
        },
        {
          id: "segment-1-8",
          speakerId: 1,
          startMs: 1_000,
          endMs: 2_100,
          text: "我们开始吧。",
          words: [{ text: "开始", startMs: 1_300, endMs: 1_800 }]
        }
      ]
    });
    expect(calls.map((call) => call.url)).toEqual([
      `https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=${DASHSCOPE_DIARIZED_ASR_MODEL}`,
      "https://temporary-oss.example.test",
      "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription",
      "https://dashscope.aliyuncs.com/api/v1/tasks/task-1",
      "https://dashscope.aliyuncs.com/api/v1/tasks/task-1",
      "https://result.example.test/transcript.json"
    ]);

    const policyHeaders = new Headers(calls[0]?.init.headers);
    expect(policyHeaders.get("authorization")).toBe("Bearer secret-key");
    const policyUrl = new URL(calls[0]?.url ?? "");
    expect(policyUrl.searchParams.get("model")).toBe(DASHSCOPE_DIARIZED_ASR_MODEL);

    const uploadForm = calls[1]?.init.body as FormData;
    expect(uploadForm.get("key")).toBe("dashscope-instant/account/date/task/客户访谈.webm");
    expect(uploadForm.get("success_action_status")).toBe("200");
    expect(await (uploadForm.get("file") as Blob).text()).toBe("audio-bytes");

    const submitHeaders = new Headers(calls[2]?.init.headers);
    expect(submitHeaders.get("x-dashscope-async")).toBe("enable");
    expect(submitHeaders.get("x-dashscope-ossresourceresolve")).toBe("enable");
    expect(JSON.parse(String(calls[2]?.init.body))).toEqual({
      model: DASHSCOPE_DIARIZED_ASR_MODEL,
      input: { file_urls: ["oss://dashscope-instant/account/date/task/客户访谈.webm"] },
      parameters: {
        diarization_enabled: true,
        channel_id: [0],
        language_hints: ["zh", "en"],
        speaker_count: 2
      }
    });
    expect(new Headers(calls[5]?.init.headers).has("authorization")).toBe(false);
  });

  it("rejects decoded audio larger than the upload policy limit before posting to OSS", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(input.toString());
      return json({
        data: {
          policy: "policy-value",
          signature: "signature-value",
          upload_dir: "temporary/path",
          upload_host: "https://temporary-oss.example.test",
          max_file_size_mb: "0.000001",
          oss_access_key_id: "oss-key",
          x_oss_object_acl: "private",
          x_oss_forbid_overwrite: "true"
        }
      });
    };

    await expect(transcribeDashScopeFile({
      input: {
        audioBase64: Buffer.from("audio larger than one byte").toString("base64"),
        mimeType: "audio/wav",
        diarizationEnabled: true
      },
      provider: {
        provider: "dashscope",
        endpointId: "asr",
        protocol: "dashscope-input-audio-chat",
        apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "secret-key",
        extraHeaders: {},
        extraBody: {}
      },
      fetch: fetchImpl,
      timeoutMs: 1_000
    })).rejects.toMatchObject({ code: "invalid_argument" });
    expect(calls).toHaveLength(1);
  });

  it("derives the native API root and tolerates missing speaker and word arrays", () => {
    expect(toDashScopeApiV1Base("https://workspace.example.test/compatible-mode/v1/"))
      .toBe("https://workspace.example.test/api/v1");
    expect(parseDashScopeTranscription({
      transcripts: [{ sentences: [{ begin_time: 10, end_time: 20, text: "待确认" }] }]
    })).toEqual({
      text: "待确认",
      segments: [{
        id: "segment-1-1",
        speakerId: null,
        startMs: 10,
        endMs: 20,
        text: "待确认",
        words: []
      }]
    });
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
