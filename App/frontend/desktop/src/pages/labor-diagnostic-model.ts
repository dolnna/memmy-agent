/** Frontend contracts for the labor-employment diagnostic PoC. */

export const LEGAL_DIAGNOSIS_COMMAND = "/legal-diagnosis";
export const LEGAL_DIAGNOSIS_PROMPT_STORAGE_KEY = "memmy.legalDiagnosis.prompt";
export const LEGAL_DIAGNOSIS_SOURCE_INPUT_STORAGE_KEY = "memmy.legalDiagnosis.sourceInput";
export const LEGAL_DIAGNOSIS_PROJECT_CONTEXT_STORAGE_KEY = "memmy.legalDiagnosis.projectId";
export const LEGAL_DIAGNOSIS_ROUTE = "/legal-diagnosis" as const;

export type LegalDiagPhaseKind = "preparing" | "collecting" | "thinking" | "task" | "review";

export type LegalDiagPhase =
  | { kind: "preparing" }
  | { kind: "collecting" }
  | { kind: "thinking"; stage: number }
  | { kind: "task" }
  | { kind: "review" };

export type LegalDiagCard = "templates" | "recording" | "materials" | "questions";
export type LegalDiagConversationAction = LegalDiagCard | "dismiss" | "generate";

/** Local UI shortcuts only; factual supplements are left in the conversation. */
export function legalDiagConversationAction(text: string): LegalDiagConversationAction | null {
  const input = text.trim().replace(/\s+/g, "").replace(/[。！!？?～~]+$/g, "");
  if (/^(先聊聊|先跳过|跳过|稍后再说|先收起|收起卡片|暂不补充|skip)$/i.test(input)) return "dismiss";
  if (/^(?:我)?(?:先|暂时|现在)?(?:不|别|无需|不用)/.test(input)) return null;
  if (/^(?:请|帮我|打开|查看|继续|回答|修改)?(?:待核实问题|待核实信息|提问卡)(?:片)?$/.test(input)) return "questions";
  if (/^(?:请|请帮我|帮我|我要|我想|现在|开始|继续)?(?:生成|出一份)(?:AI)?(?:用工风险|用工|风险)?(?:诊断)?报告(?:草稿)?(?:吧)?$/i.test(input)) return "generate";
  if (/^(?:请)?(?:帮我|给我|我要|我想|我需要|需要|打开|查看|下载|使用|获取).{0,12}模[板版](?:卡片)?(?:吧|一下)?$/.test(input)
    || /^(?:企业预填信息|企业信息|访谈诊断表|访谈记录表)?模[板版]$/.test(input)) return "templates";
  if (/^(?:我)?(?:已|已经)(?:完成|做完)(?:现场)?调研/.test(input)
    || /^(?:我要|我想|请帮我|帮我|请)?上传.{0,4}录音$/.test(input)
    || /^(?:请)?(?:帮我|我要|我想|打开|上传|添加|补充|提交).{0,8}(?:资料|材料|文件)(?:卡片)?(?:吧|一下)?$/.test(input)) return "materials";
  if (/^(?:请)?(?:帮我|我要|我想|打开|开始|进行|上传).{0,8}(?:访谈)?录音(?:卡片)?(?:吧|一下)?$/.test(input)
    || /^(?:访谈)?录音(?:吧|一下)?$/.test(input)) return "recording";
  return null;
}

export function isLegalDiagnosisCommand(text: string): boolean {
  return /(?:^|\s)\/legal-diagnosis(?=\s|$)/i.test(text);
}

/** Recognizes an explicit natural-language request to start an employment-risk diagnosis. */
export function isLegalDiagnosisNaturalIntent(text: string): boolean {
  const normalized = text.replace(/\s+/g, "").toLowerCase();
  const asksToAct = /(帮我|请|开始|开展|进行|生成|做一份|做个|做一下)/.test(normalized);
  const namesDiagnosis = /(用工|劳动用工|劳动合规).{0,8}(风险|合规)?.{0,6}(诊断|诊断报告)/.test(normalized)
    || /(用工风险诊断|用工合规诊断)/.test(normalized);
  return asksToAct && namesDiagnosis;
}

export function stripLegalDiagnosisCommand(text: string): string {
  return text.replace(/(?:^|\s)\/legal-diagnosis(?=\s|$)/gi, " ").replace(/\s+/g, " ").trim();
}

export function writeLegalDiagnosisPrompt(prompt: string, storage: Storage = window.sessionStorage): void {
  storage.setItem(LEGAL_DIAGNOSIS_PROMPT_STORAGE_KEY, prompt);
}

export function writeLegalDiagnosisSourceInput(sourceInput: string, storage: Storage = window.sessionStorage): void {
  storage.setItem(LEGAL_DIAGNOSIS_SOURCE_INPUT_STORAGE_KEY, sourceInput);
}

export function readLegalDiagnosisPrompt(storage: Storage = window.sessionStorage): string {
  return storage.getItem(LEGAL_DIAGNOSIS_PROMPT_STORAGE_KEY) ?? "";
}

export function readLegalDiagnosisSourceInput(storage: Storage = window.sessionStorage): string {
  return storage.getItem(LEGAL_DIAGNOSIS_SOURCE_INPUT_STORAGE_KEY) ?? "";
}

export function writeLegalDiagnosisProjectContext(projectId: string | null, storage: Storage = window.sessionStorage): void {
  if (projectId) storage.setItem(LEGAL_DIAGNOSIS_PROJECT_CONTEXT_STORAGE_KEY, projectId);
  else storage.removeItem(LEGAL_DIAGNOSIS_PROJECT_CONTEXT_STORAGE_KEY);
}

export function readLegalDiagnosisProjectContext(storage: Storage = window.sessionStorage): string | null {
  return storage.getItem(LEGAL_DIAGNOSIS_PROJECT_CONTEXT_STORAGE_KEY)?.trim() || null;
}

export function formatSourceSize(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const LEGAL_DIAG_SOURCE_ACCEPT = ".wav,.m4a,.mp3,.mp4,.webm,.doc,.docx,.pdf,.xls,.xlsx,.txt,.md,.png,.jpg,.jpeg";
export const LEGAL_DIAG_SOURCE_EXTENSIONS = new Set([
  "wav", "m4a", "mp3", "mp4", "webm", "doc", "docx", "pdf", "xls", "xlsx", "txt", "md", "png", "jpg", "jpeg"
]);

export function isLegalDiagSourceName(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return LEGAL_DIAG_SOURCE_EXTENSIONS.has(ext);
}
