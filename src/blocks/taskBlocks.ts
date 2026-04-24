import { formatDueDate, humanizePriority, humanizeStatus, truncate } from '../lib/format';
import { HubSpotTask } from '../types/domain';

function actionsForTask(task: HubSpotTask): any {
  return {
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '✅ Mark Done' },
        style: 'primary',
        action_id: 'task_mark_done',
        value: task.id
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '⚠️ Priority' },
        style: 'danger',
        action_id: 'task_open_priority_modal',
        value: task.id
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '⏰ Due Date' },
        action_id: 'task_open_due_date_modal',
        value: task.id
      },
      ...(task.sourceMessageLink
        ? [{
            type: 'button',
            text: { type: 'plain_text', text: '🔗 View Source' },
            url: task.sourceMessageLink,
            action_id: 'task_view_source'
          }]
        : [])
    ]
  };
}

export function singleTaskBlocks(task: HubSpotTask): any[] {
  const fields = [
    { type: 'mrkdwn', text: `*Status*\n${humanizeStatus(task.status)}` },
    { type: 'mrkdwn', text: `*Priority*\n${humanizePriority(task.priority)}` },
    { type: 'mrkdwn', text: `*Due*\n${formatDueDate(task.dueDate)}` },
    { type: 'mrkdwn', text: `*Channel*\n${task.slackChannelId ? `<#${task.slackChannelId}>` : 'None'}` }
  ];

  if (task.hubspotCompanyName || task.hubspotCompanyId) {
    fields.push({ type: 'mrkdwn', text: `*HubSpot Company*\n${task.hubspotCompanyName ?? task.hubspotCompanyId}` });
  }

  if (task.hubspotOwnerName || task.hubspotOwnerEmail || task.hubspotOwnerId) {
    fields.push({ type: 'mrkdwn', text: `*HubSpot Owner*\n${task.hubspotOwnerName ?? task.hubspotOwnerEmail ?? task.hubspotOwnerId}` });
  }

  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: `Task ${truncate(task.title, 120)}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${task.title}*` }, fields }
  ];

  if (task.notes) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Notes*\n${truncate(task.notes, 290)}` } });
  if (task.contextSnippet) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Context*\n${truncate(task.contextSnippet, 290)}` } });

  blocks.push(actionsForTask(task));
  return blocks;
}

export function taskListBlocks(title: string, tasks: HubSpotTask[]): any[] {
  if (!tasks.length) {
    return [{ type: 'section', text: { type: 'mrkdwn', text: `*${title}*\nNo tasks found.` } }];
  }

  const blocks: any[] = [{ type: 'header', text: { type: 'plain_text', text: title } }];

  for (const task of tasks.slice(0, 20)) {
    const companyLine = task.hubspotCompanyName ? `\n• HubSpot: ${task.hubspotCompanyName}` : '';
    const ownerLine = task.hubspotOwnerName || task.hubspotOwnerEmail ? `\n• Owner: ${task.hubspotOwnerName ?? task.hubspotOwnerEmail}` : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Task* ${task.title}\n• ${humanizePriority(task.priority)} priority\n• Due: ${formatDueDate(task.dueDate)}\n• Channel: ${task.slackChannelId ? `<#${task.slackChannelId}>` : 'None'}${companyLine}${ownerLine}${task.sourceMessageLink ? `\n• <${task.sourceMessageLink}|Open source message>` : ''}`
      },
      accessory: {
        type: 'button',
        action_id: 'task_mark_done',
        text: { type: 'plain_text', text: '✅ Done' },
        style: 'primary',
        value: task.id
      }
    });
    blocks.push({ type: 'divider' });
  }

  return blocks;
}
