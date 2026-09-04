/** Demo dataset for the labor-employment diagnostic workflow. */

import type { WorkspacePreviewContent } from "../components/workspace-preview-pane.js";

export const LEGAL_DIAG_ASSISTANT_INTRO = "可以先下载模板准备访谈，也可以直接录音，或通过对话框上传已有资料。需要补充说明时，直接在对话里告诉我。";
export const LEGAL_DIAG_MESSAGE_ACK = "收到，我会结合当前任务继续处理。";
export const LEGAL_DIAG_EXECUTION_INTRO = "我会结合访谈转写和调研材料整理事实、核对依据，生成用工风险诊断报告。";
export const LEGAL_DIAG_RESULT_LINE = "用工风险诊断报告已生成，可在下方查看本次产物。";

export interface LegalDiagMissingInfoQuestion {
  id: "overtimeRecords" | "occupationalInjury";
  question: string;
  options: string[];
}

export const LEGAL_DIAG_MISSING_INFO_QUESTIONS: LegalDiagMissingInfoQuestion[] = [
  {
    id: "overtimeRecords",
    question: "加班记录采用哪种保存方式？",
    options: ["纸质考勤", "电子打卡", "无记录", "暂不确定"]
  },
  {
    id: "occupationalInjury",
    question: "近 12 个月是否发生过工伤或职业病申报？",
    options: ["有", "没有", "暂不确定"]
  }
];

export const LEGAL_DIAG_MISSING_INFO_INTRO = "请先核实以下关键信息，再继续生成报告；暂时无法确认的项目可保留为待核实。";

export const LEGAL_DIAG_THINKING_STAGES = [
  "整理录音转写和补充材料",
  "提取企业事实与材料依据",
  "定位缺失信息和相互冲突的说法"
];

export const LEGAL_DIAG_VERIFICATION_TODO_INDEX = 2;

export const LEGAL_DIAG_TODO_ITEMS = [
  "整理访谈转写和调研材料",
  "核对诊断项目与材料依据",
  "核实关键信息",
  "确定整改优先级",
  "生成用工风险诊断报告"
];

export const LEGAL_DIAG_TODO_OUTPUTS = [
  "已整理访谈转写和调研材料",
  "已核对诊断项目与材料依据",
  "已整理补充信息和待核实项",
  "已确定整改优先级",
  "已生成可编辑的用工风险诊断报告"
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
  title: "用工风险诊断报告",
  sections: [
    { heading: "一、诊断背景与方法", body: "本次诊断综合现场访谈录音、企业资料和律师记录，对 151 项用工诊断与 12 项税务专项逐项核查。" },
    { heading: "二、企业基本情况", body: "企业基本画像由录音和上传材料共同提取；仅有口述、尚未获得材料验证的内容会单独标识。" },
    { heading: "三、立即处理事项", body: "现金或私卡发薪已写入立即处理。当天需要与企业确认发薪渠道、涉及人数和材料留痕。" },
    { heading: "四、证据状态", body: "已区分口头访谈、文件验证、说法冲突和待补材料。录音及资料均未覆盖的项目统一标为待核实。" },
    { heading: "五、十大板块对照", body: "高风险、中风险、低风险、合规与待核实项目已按十大板块汇总，并保留每项判定依据。" },
    { heading: "六、整改安排", body: "T 补文本、P 建流程、S 出方案及建议期次已按诊断主表自动带出，本期不继续执行分流后的工作。" }
  ]
};
