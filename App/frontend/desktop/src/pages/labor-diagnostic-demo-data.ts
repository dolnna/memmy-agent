/** Demo dataset for the labor-employment diagnostic workflow. */

import type { WorkspacePreviewContent } from "../components/workspace-preview-pane.js";

export const LEGAL_DIAG_ASSISTANT_INTRO = "点击右侧话筒打开录音列表并开始现场录音。停录转写后，可以继续补充企业提供和律师填写的材料；不需要提前逐项填写信息。";
export const LEGAL_DIAG_MESSAGE_ACK = "收到，我会结合当前任务继续处理。";
export const LEGAL_DIAG_EXECUTION_INTRO = "录音和补充材料已经进入本次诊断。我会自动整理事实、填写诊断底稿并生成报告，不再要求逐项确认。";
export const LEGAL_DIAG_RESULT_LINE = "本次诊断产物已经生成。右侧可查看访谈录音、正式转写、163 项诊断表和诊断报告。";

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

export const LEGAL_DIAG_MISSING_INFO_INTRO = "诊断底稿已完成，还有 2 项信息会影响后续判定。可以在下方卡片补充；暂不补充时，正式报告仍会生成，并将对应项目保留为待核实。";

export const LEGAL_DIAG_THINKING_STAGES = [
  "整理录音转写和补充材料",
  "提取企业事实与材料依据",
  "定位缺失信息和相互冲突的说法"
];

export const LEGAL_DIAG_TODO_ITEMS = [
  "保存访谈录音和正式转写稿",
  "填写 151 项用工诊断与 12 项税务专项",
  "生成风险判定与待核实清单",
  "带出 T / P / S 分流和建议期次",
  "生成用工风险与合规诊断报告"
];

export const LEGAL_DIAG_TODO_OUTPUTS = [
  "已保存访谈录音和正式转写稿",
  "已完成 163 项诊断底稿预填",
  "已生成风险判定与待核实清单",
  "已生成 T / P / S 分流和建议期次",
  "已生成可编辑的用工风险与合规诊断报告"
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
    { heading: "一、诊断背景与方法", body: "本次诊断综合现场访谈录音、企业资料和律师记录，对 151 项用工诊断与 12 项税务专项逐项核查。" },
    { heading: "二、企业基本情况", body: "企业基本画像由录音和上传材料共同提取；仅有口述、尚未获得材料验证的内容会单独标识。" },
    { heading: "三、立即处理事项", body: "现金或私卡发薪已写入立即处理。当天需要与企业确认发薪渠道、涉及人数和材料留痕。" },
    { heading: "四、证据状态", body: "已区分口头访谈、文件验证、说法冲突和待补材料。录音及资料均未覆盖的项目统一标为待核实。" },
    { heading: "五、十大板块对照", body: "高风险、中风险、低风险、合规与待核实项目已按十大板块汇总，并保留每项判定依据。" },
    { heading: "六、整改安排", body: "T 补文本、P 建流程、S 出方案及建议期次已按诊断主表自动带出，本期不继续执行分流后的工作。" }
  ]
};

export const LEGAL_DIAG_WORKSHEET_PREVIEW: WorkspacePreviewContent = {
  title: "用工合规及风险诊断表",
  sections: [
    { heading: "诊断范围", body: "151 项用工诊断 + 12 项税务专项，共 163 项。" },
    { heading: "已确认", body: "录音和材料共同覆盖的项目已填写企业现状，并附上对应依据。" },
    { heading: "待律师确认", body: "口述与材料不一致的项目暂不自动定级，等待律师确认。" },
    { heading: "待核实", body: "录音和材料均未涉及的项目不推断为合规或违规，统一列入待核实清单。" }
  ]
};
