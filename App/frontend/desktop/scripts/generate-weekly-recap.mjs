import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import YAML from "yaml";

/** Run one isolated Memmy Agent turn against the preview's private memory snapshot. */
export async function generateWeeklyRecap({ range, prompt, reportPath, configPath, cliPath }) {
  validateInput(range, prompt);
  if (!reportPath || !configPath || !cliPath) throw generationError(503, "真实生成尚未配置完整。");

  const recordsPath = join(dirname(reportPath), "records.json");
  const records = JSON.parse(await readFile(recordsPath, "utf8"));
  const selected = records.filter((record) => {
    const date = typeof record.recordedAt === "string" ? record.recordedAt.slice(0, 10) : "";
    return date >= range.startDate && date <= range.endDate;
  });
  if (!selected.length) throw generationError(422, "这段时间没有可用的记忆记录，请换一个时间范围。");

  const run = await mkdtemp(join(dirname(reportPath), "live-prompt-"));
  await chmod(run, 0o700);
  const compact = selected.map((record, index) =>
    `${index + 1}. ${record.recordedAt.slice(0, 10)}（记录日期） ${record.title}\n${record.summary}`
  ).join("\n\n");
  const fullPrompt = `${prompt.trim()}\n\n回顾范围：${range.startDate} 至 ${range.endDate}。以下是该范围内按记录日期筛选的 ${selected.length} 条记忆；记录日期不一定等于事件发生日期，不要补写缺失事实。\n<records>\n${compact}\n</records>`;
  await writeFile(join(run, "prompt.md"), fullPrompt, { mode: 0o600 });

  const globalConfig = await readFile(configPath);
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const beforeHash = hash(globalConfig);
  const config = YAML.parse(globalConfig.toString("utf8"));
  config.agents ??= {};
  config.agents.defaults ??= {};
  Object.assign(config.agents.defaults, { reasoningEffort: "low", maxTokens: 1800 });
  config.channels ??= {};
  Object.assign(config.channels, { showReasoning: false, sendToolHints: false });
  config.memmyMemory = { enabled: false };
  config.sessionDag = { ...(config.sessionDag ?? {}), enabled: false };
  config.contextCompaction = { ...(config.contextCompaction ?? {}), summaryMode: "text" };
  config.tools = { ...(config.tools ?? {}), mcpServers: {}, restrictToWorkspace: true };
  await mkdir(join(run, "runtime"), { mode: 0o700 });
  await writeFile(join(run, "config.yaml"), YAML.stringify(config), { mode: 0o600 });

  const env = {
    ...process.env,
    MEMMY_CONFIG: join(run, "config.yaml"),
    MEMMY_AGENT_DATA_DIR: run,
    MEMMY_AGENT_WORKSPACE: join(run, "runtime"),
    MEMMY_AGENT_SESSION_DAG_DIR: join(run, "session-dag"),
    MEMMY_MEMORY_URL: "http://127.0.0.1:1",
  };
  delete env.MEMMY_APP_DATABASE;
  const child = spawn(cliPath, [
    "agent", "--standalone", "--config", join(run, "config.yaml"),
    "--workspace", join(run, "runtime"), "--no-markdown", "--no-logs",
  ], { cwd: run, env, stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  child.stdin.on("error", () => undefined);
  child.stdin.end(fullPrompt);

  const exitCode = await waitForChild(child, 180_000);
  await writeFile(join(run, "output.log"), output, { mode: 0o600 });
  const afterHash = hash(await readFile(configPath));
  if (beforeHash !== afterHash) throw generationError(500, "生成期间本地配置发生变化，结果未采用。");

  const body = await readFinalAssistant(join(run, "runtime", "sessions"));
  if (!body) throw generationError(502, exitCode === 0 ? "Memmy Agent 没有返回可用正文。" : "Memmy Agent 生成失败，请稍后重试。");
  await writeFile(join(run, "model-final.md"), body, { mode: 0o600 });
  await writeFile(join(run, "result.json"), JSON.stringify({
    generated: true, exitCode, globalConfigUnchanged: true,
    recordCount: selected.length, outputCharacters: body.length,
  }, null, 2), { mode: 0o600 });

  return {
    report: {
      id: `memmy-recap-${randomUUID()}`,
      startDate: range.startDate,
      endDate: range.endDate,
      body,
      insights: [],
      sources: [],
    },
    meta: { recordCount: selected.length, generatedBy: "Memmy Agent · exposed prompt", generatedAt: new Date().toISOString() },
  };
}

function validateInput(range, prompt) {
  if (!range || !isDate(range.startDate) || !isDate(range.endDate) || range.startDate > range.endDate) {
    throw generationError(400, "时间范围无效。");
  }
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 12_000) {
    throw generationError(400, "Prompt 不能为空，且不能超过 12000 个字符。");
  }
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function waitForChild(child, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
      reject(generationError(504, "Memmy Agent 生成超时，请重试。"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve(code));
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readFinalAssistant(sessionDir) {
  const names = (await readdir(sessionDir)).filter((name) => /^cli_.*\.jsonl$/.test(name));
  for (const name of names) {
    const rows = (await readFile(join(sessionDir, name), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row?.role === "assistant" && typeof row.content === "string" && row.content.trim() &&
          !row.tool_calls?.length && !row.model_error && row.finish_reason === "stop") return row.content.trim();
    }
  }
  return null;
}

function generationError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
