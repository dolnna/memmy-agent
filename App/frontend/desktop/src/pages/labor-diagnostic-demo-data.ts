/** Demo dataset for the labor-employment diagnostic workflow. */

import type { WorkspaceFilesListing } from "../api/memmy-agent-client.js";
import type { WorkspacePreviewContent } from "../components/workspace-preview-pane.js";

export const LEGAL_DIAG_ASSISTANT_INTRO = "先补企业变量空项，再上传访谈录音。齐了我就按诊断表出报告。";
export const LEGAL_DIAG_MESSAGE_ACK = "收到，我会结合当前任务继续处理。";
export const LEGAL_DIAG_EXECUTION_INTRO = "企业变量和资料已经齐了。我先裁剪十大板块、做出现状判定，再按模板逐章写诊断报告。";
export const LEGAL_DIAG_RESULT_LINE = "诊断报告已经生成。立即、高风险、待核实列在前面，改一项只更新对应章节。";

export const LEGAL_DIAG_MISSING_INFO_ITEMS = [
  "加班记录保存方式（纸质考勤 / 电子打卡 / 无记录）？影响加班费计算口径的判定。",
  "近 12 个月是否发生过工伤或职业病申报？影响风险敞口测算。"
];

export const LEGAL_DIAG_MISSING_INFO_INTRO = "以下信息在录音和资料中未提及，补充后我会更新对应章节：";

export const LEGAL_DIAG_THINKING_STAGES = [
  "按企业变量裁剪十大板块",
  "对照应然做出现状判定",
  "按建议期次整理立即处理事项"
];

export const LEGAL_DIAG_TODO_ITEMS = [
  "诊断背景与方法",
  "企业基本情况",
  "立即处理事项",
  "风险敞口测算",
  "十大板块对照",
  "整改安排"
];

export interface LegalDiagExceptionItem {
  id: string;
  title: string;
  judgment: "高风险" | "待核实" | "立即";
  period: string;
  tps: "T" | "P" | "S";
}

export const LEGAL_DIAG_EXCEPTION_ITEMS: LegalDiagExceptionItem[] = [
  { id: "e1", title: "现金或私卡发薪", judgment: "立即", period: "立即", tps: "P" },
  { id: "e2", title: "规章制度未经民主程序", judgment: "高风险", period: "一期·证据", tps: "P" },
  { id: "e3", title: "加班费计算口径", judgment: "待核实", period: "三期·负债", tps: "S" }
];

export const LEGAL_DIAG_REPORT_PREVIEW: WorkspacePreviewContent = {
  title: "用工风险与合规诊断报告",
  sections: [
    { heading: "一、诊断背景与方法", body: "本次诊断按十大板块对照应然与实然，现场录音转写后自动做出现状判定。" },
    { heading: "二、企业基本情况", body: "参保地、用工形式、发薪方式和工会情况来自企业变量表，后续章节复用这些变量。" },
    { heading: "三、立即处理事项", body: "现金或私卡发薪已写入立即处理。当天需要与老板对齐发薪渠道和留痕方式。" },
    { heading: "四、风险敞口测算", body: "社保基数缺口、加班费和未参保工伤按参保地数值估算，其他城市请律师补当地数字。" },
    { heading: "五、十大板块对照", body: "不适用的特殊用工、职业卫生和选配项已按企业变量折叠。高风险与待核实见报告前部。" },
    { heading: "六、整改安排", body: "T 类从模板填企业变量出文本，P 类出流程并进入陪跑，S 类另填个案信息表。" }
  ]
};

export const LEGAL_DIAG_TRANSCRIPT_PREVIEW: WorkspacePreviewContent = {
  title: "访谈转写",
  sections: [
    { heading: "00:12", body: "我们这边主要是劳动合同用工，工资走银行代发，没有工会。" },
    { heading: "03:40", body: "想先把用工体系搭起来，现场也提到有个别岗位加班比较多。" }
  ]
};

const ROOT_LABEL = "用工风险诊断";

function file(name: string, path: string, size: number) {
  return { name, path, kind: "file" as const, size, modifiedAt: null };
}

function directory(name: string, path: string) {
  return { name, path, kind: "directory" as const, size: null, modifiedAt: null };
}

export function buildLegalDiagListing(relativePath: string, ready: boolean): WorkspaceFilesListing {
  const root = { kind: "task" as const, label: ROOT_LABEL };
  if (!ready) {
    return { root, path: relativePath, truncated: false, entries: [] };
  }
  if (relativePath === "reports") {
    return {
      root,
      path: relativePath,
      truncated: false,
      entries: [file("用工风险与合规诊断报告.md", "reports/用工风险与合规诊断报告.md", 4200)]
    };
  }
  if (relativePath === "transcripts") {
    return {
      root,
      path: relativePath,
      truncated: false,
      entries: [file("访谈转写.txt", "transcripts/访谈转写.txt", 1800)]
    };
  }
  if (relativePath === "recordings") {
    return {
      root,
      path: relativePath,
      truncated: false,
      entries: [file("访谈录音.m4a", "recordings/访谈录音.m4a", 240000)]
    };
  }
  return {
    root,
    path: relativePath,
    truncated: false,
    entries: [
      directory("reports", "reports"),
      directory("transcripts", "transcripts"),
      directory("recordings", "recordings")
    ]
  };
}

export function buildLegalDiagPreview(path: string): WorkspacePreviewContent | null {
  if (path.endsWith("诊断报告.md")) return LEGAL_DIAG_REPORT_PREVIEW;
  if (path.endsWith("转写.txt")) return LEGAL_DIAG_TRANSCRIPT_PREVIEW;
  if (path.endsWith(".m4a")) {
    return { title: "访谈录音.m4a", sections: [{ heading: "录音", body: "本期以转写文本预览。后续可在 App 内直接播放。" }] };
  }
  return null;
}
