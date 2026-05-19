export interface IPipelineStage {
  _id: string;
  name: string;
  color: string;
  order: number;
  isActive: boolean;
  icon: string;
}

export const PIPELINE_STAGE_ICONS = [
  // Review & Assessment
  'ClipboardList',
  'ClipboardCheck',
  'FileText',
  'FileSearch',
  'FileScan',
  'FileCheck',
  // Communication
  'Phone',
  'PhoneCall',
  'Mail',
  'MessageSquare',
  'Video',
  'Mic',
  // People
  'User',
  'Users',
  'UserCheck',
  'UserSearch',
  'Handshake',
  // Interview & Evaluation
  'Star',
  'Award',
  'Trophy',
  'Target',
  'CheckCircle',
  'ThumbsUp',
  // Process
  'Clock',
  'Calendar',
  'Timer',
  'Hourglass',
  'ArrowRight',
  'GitPullRequest',
  // Documents
  'Paperclip',
  'BookOpen',
  'Briefcase',
  'Badge',
  'Clipboard',
  // Status
  'AlertCircle',
  'Info',
  'HelpCircle',
  'Flag',
  'Tag',
  'Bookmark',
  // Misc
  'Search',
  'Filter',
  'Settings',
  'LayoutKanban',
  'List',
  'Layers',
] as const

export type PipelineStageIcon = typeof PIPELINE_STAGE_ICONS[number]

export interface IPipelineTemplate {
  _id: string;
  name: string;
  description: string;
  isDefault: boolean;
  isActive: boolean;
  stages: IPipelineStage[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePipelineTemplateInput {
  name: string;
  description?: string;
  isDefault?: boolean;
  stages: {
    name: string;
    color?: string;
    order: number;
    isActive?: boolean;
  }[];
}

export interface UpdatePipelineTemplateInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
  isActive?: boolean;
  stages?: {
    name: string;
    color?: string;
    order: number;
    isActive?: boolean;
  }[];
}
