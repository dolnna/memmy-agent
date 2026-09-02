/** Frontend contracts for the labor-employment diagnostic PoC. */

export const LEGAL_DIAGNOSIS_COMMAND = "/legal-diagnosis";
export const LEGAL_DIAGNOSIS_PROMPT_STORAGE_KEY = "memmy.legalDiagnosis.prompt";
export const LEGAL_DIAGNOSIS_SOURCE_INPUT_STORAGE_KEY = "memmy.legalDiagnosis.sourceInput";
export const LEGAL_DIAGNOSIS_PROJECT_CONTEXT_STORAGE_KEY = "memmy.legalDiagnosis.projectId";
export const LEGAL_DIAGNOSIS_ROUTE = "/legal-diagnosis" as const;

export type LegalDiagPhaseKind = "preparing" | "recording" | "materials" | "thinking" | "task" | "review";

export type LegalDiagPhase =
  | { kind: "preparing" }
  | { kind: "recording" }
  | { kind: "materials" }
  | { kind: "thinking"; stage: number }
  | { kind: "task" }
  | { kind: "review" };

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

export const LEGAL_DIAG_SOURCE_ACCEPT = ".wav,.m4a,.mp3,.mp4,.webm,.docx,.pdf,.xlsx,.txt,.md,.png,.jpg,.jpeg";
export const LEGAL_DIAG_SOURCE_EXTENSIONS = new Set([
  "wav", "m4a", "mp3", "mp4", "webm", "docx", "pdf", "xlsx", "txt", "md", "png", "jpg", "jpeg"
]);

export function isLegalDiagSourceName(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return LEGAL_DIAG_SOURCE_EXTENSIONS.has(ext);
}
