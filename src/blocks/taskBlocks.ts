import { KnownBlock, Block, MrkdwnElement } from '@slack/bolt';
import { Task } from '@prisma/client';
import { formatDueDate, humanizePriority, humanizeStatus, truncate } from '../lib/format';

function actionsForTask(task: Task): Block {
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
          } as const]
        : [])
    ]
  };
}

export function singleTaskBlocks(task: Task): (KnownBlock | Block)[] {
  const fields: MrkdwnElement[] = [
    { type: 'mrkdwn', text: `*Status*\n${humanizeStatus(task.status)}` },
    { type: 'mrkdwn', text: `*Priority*\n${humanizePriority(task.priority)}` },
    { type: 'mrkdwn', text: `*Due*\n${formatDueDate(task.dueDate)}` },
    { type: 'mrkdwn', text: `*Creator*\n<#${task.creatorChannelId}>` }
  ];

  const blocks: (KnownBlock | Block)[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Task #${task.id}` }
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

export function taskListBlocks(title: string, tasks: Task[]): (KnownBlock | Block)[] {
  if (!tasks.length) {
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${title}*\nNo tasks found.` }
      }
    ];
  }

  const blocks: (KnownBlock | Block)[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: title }
    }
  ];

  for (const task of tasks.slice(0, 20)) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*#${task.id}* ${task.title}\n• ${humanizePriority(task.priority)} priority\n• Due: ${formatDueDate(task.dueDate)}\n• Creator: <#${task.creatorChannelId}>${task.sourceMessageLink ? `\n• <${task.sourceMessageLink}|Open source message>` : ''}`
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
