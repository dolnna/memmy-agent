/** Frontend contracts for the labor-employment diagnostic PoC. */

export const LEGAL_DIAGNOSIS_COMMAND = "/legal-diagnosis";
export const LEGAL_DIAGNOSIS_PROMPT_STORAGE_KEY = "memmy.legalDiagnosis.prompt";
export const LEGAL_DIAGNOSIS_ROUTE = "/legal-diagnosis" as const;

export type LegalDiagPhaseKind = "setup" | "sources" | "thinking" | "task" | "review";

export type LegalDiagPhase =
  | { kind: "setup" }
  | { kind: "sources" }
  | { kind: "thinking"; stage: number }
  | { kind: "task" }
  | { kind: "review" };

export type LegalDiagQuestionId =
  | "companyName"
  | "location"
  | "employment"
  | "payroll"
  | "union"
  | "industry"
  | "pending"
  | "need";

export interface LegalDiagQuestion {
  id: LegalDiagQuestionId;
  text: string;
  options: readonly string[];
  freeText?: boolean;
}

export const LEGAL_DIAG_QUESTIONS: readonly LegalDiagQuestion[] = [
  { id: "companyName", text: "公司全称", options: [], freeText: true },
  {
    id: "location",
    text: "参保地",
    options: ["上海", "北京", "深圳", "杭州", "南京", "其他"]
  },
  {
    id: "employment",
    text: "用工形式",
    options: ["劳动合同", "劳务派遣", "外包", "返聘", "实习", "非全日制"]
  },
  {
    id: "payroll",
    text: "发薪方式",
    options: ["银行代发", "现金", "私卡"]
  },
  {
    id: "union",
    text: "工会",
    options: ["已设工会或职代会", "未设工会"]
  },
  {
    id: "industry",
    text: "行业与岗位",
    options: ["不涉职业病或高管", "涉职业病或特殊作业", "有涉密或高管岗位"]
  },
  {
    id: "pending",
    text: "在办事项",
    options: ["无在办事项", "在办稽查", "在办仲裁", "在办工伤"]
  },
  {
    id: "need",
    text: "当前要办的事",
    options: ["搭建用工体系", "解除某名员工", "降薪或调岗", "社保或金税", "已有仲裁或工伤"]
  }
];

export function isLegalDiagnosisCommand(text: string): boolean {
  return /(?:^|\s)\/legal-diagnosis(?=\s|$)/i.test(text);
}

export function stripLegalDiagnosisCommand(text: string): string {
  return text.replace(/(?:^|\s)\/legal-diagnosis(?=\s|$)/gi, " ").replace(/\s+/g, " ").trim();
}

export function writeLegalDiagnosisPrompt(prompt: string, storage: Storage = window.sessionStorage): void {
  storage.setItem(LEGAL_DIAGNOSIS_PROMPT_STORAGE_KEY, prompt);
}

export function readLegalDiagnosisPrompt(storage: Storage = window.sessionStorage): string {
  return storage.getItem(LEGAL_DIAGNOSIS_PROMPT_STORAGE_KEY) ?? "";
}

export function formatSourceSize(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const LEGAL_DIAG_SOURCE_ACCEPT = ".wav,.m4a,.mp3,.docx,.pdf,.xlsx,.doc,.txt,.md";
export const LEGAL_DIAG_SOURCE_EXTENSIONS = new Set([
  "wav", "m4a", "mp3", "docx", "pdf", "xlsx", "doc", "txt", "md"
]);

export function isLegalDiagSourceName(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return LEGAL_DIAG_SOURCE_EXTENSIONS.has(ext);
}
