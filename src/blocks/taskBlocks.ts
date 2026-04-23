import { Task } from '@prisma/client';
import { formatDueDate, humanizePriority, humanizeStatus, truncate } from '../lib/format';

function actionsForTask(task: Task): any {
  return {
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Mark Done' },
        style: 'primary',
        action_id: 'task_mark_done',
        value: String(task.id)
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Priority' },
        action_id: 'task_open_priority_modal',
        value: String(task.id)
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Due Date' },
        action_id: 'task_open_due_date_modal',
        value: String(task.id)
      },
      ...(task.sourceMessageLink
        ? [{
            type: 'button',
            text: { type: 'plain_text', text: 'View Source' },
            url: task.sourceMessageLink,
            action_id: 'task_view_source'
          }]
        : [])
    ]
  };
}

export function singleTaskBlocks(task: Task): any[] {
  const fields = [
    { type: 'mrkdwn', text: `*Status*\n${humanizeStatus(task.status)}` },
    { type: 'mrkdwn', text: `*Priority*\n${humanizePriority(task.priority)}` },
    { type: 'mrkdwn', text: `*Due*\n${formatDueDate(task.dueDate)}` },
    { type: 'mrkdwn', text: `*Creator*\n<#${task.creatorChannelId}>` }
  ];

  if (task.hubspotCompanyName || task.hubspotCompanyId) {
    fields.push({
      type: 'mrkdwn',
      text: `*HubSpot Company*\n${task.hubspotCompanyName ?? task.hubspotCompanyId}`
    });
  }

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Task ${truncate(task.title, 120)}` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${task.title}*` },
      fields
    }
  ];

  if (task.contextSnippet) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Context*\n${truncate(task.contextSnippet, 290)}` }
    });
  }

  blocks.push(actionsForTask(task));
  return blocks;
}

export function taskListBlocks(title: string, tasks: Task[]): any[] {
  if (!tasks.length) {
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${title}*\nNo tasks found.` }
      }
    ];
  }

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: title }
    }
  ];

  for (const task of tasks.slice(0, 20)) {
    const companyLine = task.hubspotCompanyName ? `\n• HubSpot: ${task.hubspotCompanyName}` : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Task* ${task.title}\n• ${humanizePriority(task.priority)} priority\n• Due: ${formatDueDate(task.dueDate)}\n• Creator: <#${task.creatorChannelId}>${companyLine}${task.sourceMessageLink ? `\n• <${task.sourceMessageLink}|Open source message>` : ''}`
      },
      accessory: {
        type: 'button',
        action_id: 'task_mark_done',
        text: { type: 'plain_text', text: 'Done' },
        style: 'primary',
        value: String(task.id)
      }
    });
    blocks.push({ type: 'divider' });
  }

  return blocks;
}
