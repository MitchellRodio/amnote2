
// UPDATED hubspot.ts - priority fix
import { ChannelLink, Task, TaskPriority, TaskStatus } from '@prisma/client';
import { env } from './env';
import { prisma } from './db';

function mapPriority(priority: TaskPriority): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (priority === 'HIGH') return 'HIGH';
  if (priority === 'LOW') return 'LOW';
  return 'MEDIUM';
}

function mapStatus(status: TaskStatus): 'COMPLETED' | 'NOT_STARTED' {
  return status === 'DONE' ? 'COMPLETED' : 'NOT_STARTED';
}

function buildTaskBody(task: Task): string {
  return [
    task.notes,
    task.contextSnippet ? `Context: ${task.contextSnippet}` : undefined,
    task.sourceMessageLink ? `Slack source: ${task.sourceMessageLink}` : undefined,
    task.creatorChannelName ? `Slack channel: #${task.creatorChannelName}` : undefined
  ].filter(Boolean).join('\n\n');
}

function buildMetadata(task: Task) {
  return {
    subject: task.title,
    body: buildTaskBody(task) || 'Created from Slack',
    status: mapStatus(task.status),

    // 🔥 FIX
    priority: mapPriority(task.priority),
    taskType: 'TODO',
    forObjectType: 'COMPANY'
  };
}

export async function updateHubSpotTask(task: Task): Promise<void> {
  if (!task.hubspotTaskId) return;

  await fetch(`${env.HUBSPOT_BASE_URL}/engagements/v1/engagements/${task.hubspotTaskId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${env.HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      engagement: {
        active: true,
        type: 'TASK'
      },
      metadata: buildMetadata(task)
    })
  });
}
