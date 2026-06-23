export interface Task {
  id: string;
  name: string;
  category: string;
  platform: string;
  status: string;
  externalId: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface TemplateParameter {
  key: string;
  label: string;
  type: string; // text | path | url | number | select
  default?: string;
  required?: boolean;
  help?: string;
  options?: string[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  sourcePlatform: string;
  targetPlatforms: string[];
  scheduleExpression: string;
  command: string;
  upvotes: number;
  scriptType?: string;
  os?: string;
  category?: string;
  commandTemplate?: string | null;
  parameters?: TemplateParameter[] | null;
  isStarter?: boolean;
  icon?: string | null;
}

export interface PlatformLink {
  id: string;
  name: string;
  url: string;
  iconType: string;
}
