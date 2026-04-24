export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type TaskStatus = 'OPEN' | 'DONE';

export type HubSpotTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: Date | null;
  notes?: string;
  slackChannelId?: string;
  slackChannelName?: string;
  slackUserId?: string;
  sourceMessageLink?: string;
  contextSnippet?: string;
  hubspotOwnerId?: string;
  hubspotOwnerName?: string;
  hubspotOwnerEmail?: string;
  hubspotCompanyId?: string;
  hubspotCompanyName?: string;
  createdAt?: Date | null;
};

export const TASK_PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH'];
