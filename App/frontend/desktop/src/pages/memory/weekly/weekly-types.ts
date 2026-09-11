export interface WeeklySource {
  id: string;
  app: string;
  title: string;
  time: string;
  excerpt: string;
}

export interface WeeklyInsight {
  id: string;
  label: string;
  title: string;
  body: string;
  prompt: string;
  sourceIds: string[];
}

export interface WeeklyReport {
  id: string;
  startDate: string;
  endDate: string;
  body?: string;
  insights: WeeklyInsight[];
  sources: WeeklySource[];
}
