import type { WeeklyReport } from "./weekly-types";

/** Deliberately fictional preview fixtures. No private account or conversation data. */
export const previewWeeklyReports: WeeklyReport[] = [
  {
    id: "week-2026-08-31",
    startDate: "2026-08-31",
    endDate: "2026-09-06",
    insights: [
      {
        id: "w3-insight-progress",
        label: "本周的变化",
        title: "两件事都有了能接着用的结构",
        body: "综述从收集材料推进到初稿，工作台也把零散事项整理成固定板块。下周可以继续补充和推进这些成果。",
        prompt: "下周我应该优先推进什么？",
        sourceIds: [
          "w3-research-draft",
          "w3-research-followup",
          "w3-workspace-organize",
          "w3-workspace-review",
        ],
      },
      {
        id: "w3-insight-feedback",
        label: "值得确认",
        title: "工作台试用反馈，可能还有后续",
        body: "你提过会收集新版工作台的试用反馈，这周的记录里还没看到结果。如果已经收齐，可以补充进来一起看看。",
        prompt: "工作台反馈这件事进展到哪了？",
        sourceIds: ["w3-workspace-feedback"],
      },
      {
        id: "w3-insight-method",
        label: "可以沿用",
        title: "保留依据，正文只写重点",
        body: "你已经确认：研究结论要能找到出处，待办按工作板块整理，每项只留进展和下一步。这些做法可以继续用于下周的整理。",
        prompt: "下次整理时可以沿用哪些做法？",
        sourceIds: ["w3-writing-rule", "w3-workspace-organize"],
      },
    ],
    sources: [
      {
        id: "w3-research-draft",
        app: "Claude Code",
        title: "完成第一版正文",
        time: "2026-09-02T15:10:00+08:00",
        excerpt:
          "第一版正文已经整理好了，关键观点保留对应文献出处。有关长期任务收益的证据还不够，先不要写成确定结论。",
      },
      {
        id: "w3-research-followup",
        app: "Claude Code",
        title: "为下周保留补充研究",
        time: "2026-09-04T16:30:00+08:00",
        excerpt: "对照研究这周先不补，下周补两类对照方法，再回头核对初稿结论。",
      },
      {
        id: "w3-workspace-organize",
        app: "Memmy",
        title: "按板块整理工作事项",
        time: "2026-08-31T18:00:00+08:00",
        excerpt:
          "事项已经归到研究写作、日常工作、设计验证三个板块，同目标的重复任务也合并好了。以后也这样整理，每项只留进展和下一步。",
      },
      {
        id: "w3-workspace-review",
        app: "Memmy",
        title: "检查板块整理结果",
        time: "2026-09-03T10:10:00+08:00",
        excerpt:
          "按主题分好以后清楚多了。保留这版结构，下次继续更新这些目标就好。",
      },
      {
        id: "w3-workspace-feedback",
        app: "Memmy",
        title: "计划收集工作台反馈",
        time: "2026-09-03T14:00:00+08:00",
        excerpt: "新版工作台准备请两位试用者看一下，我来收集他们的反馈。",
      },
      {
        id: "w3-writing-rule",
        app: "Claude Code",
        title: "确认研究写作习惯",
        time: "2026-09-02T15:25:00+08:00",
        excerpt:
          "以后整理研究也这样：结论要能回到原始证据，没有依据的就标待验证，不要为了完整补写结论。",
      },
    ],
  },
];
