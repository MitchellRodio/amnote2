import { App, LogLevel } from '@slack/bolt';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { TaskPriority, TaskStatus } from '@prisma/client';
import { env } from './lib/env';
import { buildCreateTaskModal, buildDueDateModal, buildPriorityModal, buildSlashTodoModal } from './blocks/modals';
import { singleTaskBlocks, taskListBlocks } from './blocks/taskBlocks';
import { fetchContextSnippet } from './lib/context';
import { sanitizeTaskTitle } from './lib/format';
import {
  createTask,
  listOverdueTasks,
  listTasksForChannel,
  listTasksForUser,
  taskCountsForToday,
  updateTaskDueDate,
  updateTaskPriority,
  updateTaskStatus
} from './lib/tasks';
import { prisma } from './lib/db';
import { findCompanyForChannel, saveChannelLink, searchCompanies, updateHubSpotTask } from './lib/hubspot';

dayjs.extend(utc);
dayjs.extend(timezone);

const app = new App({
  token: env.SLACK_BOT_TOKEN,
  appToken: env.SLACK_APP_TOKEN,
  socketMode: true,
  signingSecret: env.SLACK_SIGNING_SECRET,
  logLevel: env.SLACK_LOG_LEVEL as LogLevel
});

function taskMeta(params: Record<string, unknown>): string {
  return JSON.stringify(params);
}

function taskCreatedEphemeralBlocks(task: any) {
  return [
    ...singleTaskBlocks(task),
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Clear Msg'
          },
          action_id: 'clear_ephemeral_message',
          value: 'clear'
        }
      ]
    }
  ];
}

function listWithClearBlocks(title: string, tasks: any[]) {
  return [
    ...taskListBlocks(title, tasks),
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Clear Msg'
          },
          action_id: 'clear_ephemeral_message',
          value: 'clear'
        }
      ]
    }
  ];
}

async function createTaskFromMessage(args: {
  channelId: string;
  channelName?: string;
  userId: string;
  userName?: string;
  text: string;
  sourceTs?: string;
  threadTs?: string;
}) {
  const title = sanitizeTaskTitle(args.text);
  if (!title) {
    throw new Error('Task title is required');
  }

  let sourceMessageLink: string | undefined;
  let contextSnippet: string | undefined;

  if (args.sourceTs) {
    const permalink = await app.client.chat.getPermalink({
      channel: args.channelId,
      message_ts: args.sourceTs
    });
    sourceMessageLink = permalink.permalink;
    contextSnippet = await fetchContextSnippet(app, args.channelId, args.threadTs ?? args.sourceTs);
  }

  return createTask({
    title,
    creatorChannelId: args.channelId,
    creatorChannelName: args.channelName,
    createdByUserId: args.userId,
    createdByName: args.userName,
    assignedToUserId: args.userId,
    assignedToName: args.userName,
    sourceMessageTs: args.sourceTs,
    sourceMessageLink,
    threadTs: args.threadTs,
    contextSnippet
  });
}

async function sendTaskCreatedDm(
  task: {
    id: number;
    title: string;
    creatorChannelId: string;
    sourceMessageLink?: string | null;
    contextSnippet?: string | null;
    priority: TaskPriority;
    status: TaskStatus;
    dueDate?: Date | null;
  },
  userId: string
) {
  const dm = await app.client.conversations.open({ users: userId });
  const channelId = dm.channel?.id;
  if (!channelId) return;

  await app.client.chat.postMessage({
    channel: channelId,
    text: `Task created: ${task.title}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Task created* in <#${task.creatorChannelId}>`
        }
      },
      ...singleTaskBlocks(task as any)
    ]
  });
}

app.command('/todo', async ({ ack, command, client, respond }) => {
  await ack();

  const initialTitle = sanitizeTaskTitle(command.text);
  if (!initialTitle) {
    await respond({
      response_type: 'ephemeral',
      text: 'Use `/todo Your task here` inside a creator channel.'
    });
    return;
  }

  const metadata = taskMeta({
    channelId: command.channel_id,
    channelName: command.channel_name,
    userId: command.user_id,
    userName: command.user_name
  });

  await client.views.open({
    trigger_id: command.trigger_id,
    view: buildSlashTodoModal(metadata, initialTitle)
  });
});

app.command('/link', async ({ ack, command, respond }) => {
  await ack();

  const raw = command.text.trim();
  if (!raw) {
    await respond({
      response_type: 'ephemeral',
      text: 'Use `/link <HubSpot company ID or company name>` in the creator channel you want to link.'
    });
    return;
  }

  let company = null;
  if (/^\d+$/.test(raw)) {
    const matched = await findCompanyForChannel({ channelId: undefined, channelName: raw });
    company = matched;
    if (!company || company.id !== raw) {
      const results = await searchCompanies(raw);
      company = results.find((item) => item.id === raw) ?? null;
    }
  } else {
    const results = await searchCompanies(raw);
    company = results[0] ?? null;
  }

  if (!company?.id) {
    await respond({
      response_type: 'ephemeral',
      text: `Could not find a HubSpot company for "${raw}".`
    });
    return;
  }

  const companyName = company.properties?.name ?? company.properties?.hs_name ?? company.id;
  await saveChannelLink({
    slackChannelId: command.channel_id,
    slackChannelName: command.channel_name,
    hubspotCompanyId: company.id,
    hubspotCompanyName: companyName
  });

  await respond({
    response_type: 'ephemeral',
    text: `Linked this channel to HubSpot company *${companyName}* (${company.id}).`
  });
});

app.command('/mytodos', async ({ ack, command, respond }) => {
  await ack();
  const tasks = await listTasksForUser(command.user_id);
  await respond({
    response_type: 'ephemeral',
    blocks: listWithClearBlocks('My Open Tasks', tasks)
  });
});

app.command('/list', async ({ ack, command, respond }) => {
  await ack();
  const tasks = await listTasksForUser(command.user_id);
  await respond({
    response_type: 'ephemeral',
    blocks: listWithClearBlocks('My Open Tasks', tasks)
  });
});

app.command('/todos', async ({ ack, command, respond }) => {
  await ack();
  const tasks = await listTasksForChannel(command.channel_id);
  await respond({
    response_type: 'ephemeral',
    blocks: listWithClearBlocks(`Tasks for #${command.channel_name}`, tasks)
  });
});

app.command('/overdue', async ({ ack, command, respond }) => {
  await ack();
  const tasks = await listOverdueTasks(command.user_id);
  await respond({
    response_type: 'ephemeral',
    blocks: listWithClearBlocks('My Overdue Tasks', tasks)
  });
});

app.command('/today', async ({ ack, command, respond }) => {
  await ack();
  const [counts, overdue] = await Promise.all([
    taskCountsForToday(command.user_id),
    listOverdueTasks(command.user_id)
  ]);

  const text = `You have ${counts.total} open tasks, ${counts.high} high-priority tasks, and ${counts.overdue} overdue tasks.`;
  await respond({
    response_type: 'ephemeral',
    text,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Your Day' }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text }
      },
      ...taskListBlocks('Overdue First', overdue).slice(0, 6),
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Clear Msg'
            },
            action_id: 'clear_ephemeral_message',
            value: 'clear'
          }
        ]
      }
    ]
  });
});

app.shortcut('create_task_from_message', async ({ ack, shortcut, client }) => {
  await ack();
  if (!('message' in shortcut) || !shortcut.message) {
    return;
  }

  const initialTitle = sanitizeTaskTitle(shortcut.message.text || 'Follow up');
  const metadata = taskMeta({
    channelId: shortcut.channel.id,
    channelName: shortcut.channel.name,
    sourceTs: shortcut.message.ts,
    threadTs: shortcut.message.thread_ts ?? shortcut.message.ts,
    userId: shortcut.user.id,
    userName: shortcut.user.name ?? shortcut.user.username ?? 'Unknown'
  });

  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: buildCreateTaskModal(metadata, initialTitle)
  });
});

app.view('create_task_modal_submit', async ({ ack, body, view, client }) => {
  await ack();
  const metadata = JSON.parse(view.private_metadata) as {
    channelId: string;
    channelName?: string;
    sourceTs?: string;
    threadTs?: string;
    userId: string;
    userName?: string;
  };

  const title = view.state.values.task_title?.value?.value ?? '';
  const notes = view.state.values.task_notes?.value?.value ?? undefined;

  const task = await createTaskFromMessage({
    channelId: metadata.channelId,
    channelName: metadata.channelName,
    userId: metadata.userId,
    userName: metadata.userName,
    text: title,
    sourceTs: metadata.sourceTs,
    threadTs: metadata.threadTs
  });

  if (notes) {
    await prisma.task.update({ where: { id: task.id }, data: { notes } });
  }

  const updatedTask = await prisma.task.findUnique({
    where: { id: task.id }
  });

  if (!updatedTask) return;

  await client.chat.postEphemeral({
    channel: metadata.channelId,
    user: body.user.id,
    text: `Created task "${updatedTask.title}"`,
    blocks: taskCreatedEphemeralBlocks(updatedTask)
  });

  await sendTaskCreatedDm(updatedTask as any, body.user.id);
});

app.view('slash_todo_modal_submit', async ({ ack, body, view, client }) => {
  await ack();

  const metadata = JSON.parse(view.private_metadata) as {
    channelId: string;
    channelName?: string;
    userId: string;
    userName?: string;
  };

  const title = sanitizeTaskTitle(view.state.values.task_title?.value?.value ?? '');
  const notes = view.state.values.task_notes?.value?.value ?? undefined;
  const priority =
    (view.state.values.priority?.value?.selected_option?.value as TaskPriority | undefined) ??
    TaskPriority.MEDIUM;

  const date = view.state.values.due_date?.value?.selected_date;
  const hourRaw = view.state.values.due_time?.value?.value;
  const parsedHour = hourRaw ? Number(hourRaw) : env.DEFAULT_REMINDER_HOUR;
  const hour = Number.isFinite(parsedHour)
    ? Math.min(23, Math.max(0, parsedHour))
    : env.DEFAULT_REMINDER_HOUR;

  const dueDate = date
    ? dayjs.tz(
        `${date} ${String(hour).padStart(2, '0')}:00`,
        'YYYY-MM-DD HH:mm',
        env.TIMEZONE
      ).toDate()
    : undefined;

  if (!title) {
    await client.chat.postEphemeral({
      channel: metadata.channelId,
      user: body.user.id,
      text: 'Task title is required.'
    });
    return;
  }

  const task = await createTaskFromMessage({
    channelId: metadata.channelId,
    channelName: metadata.channelName,
    userId: metadata.userId,
    userName: metadata.userName,
    text: title
  });

  const updatedTask = await prisma.task.update({
    where: { id: task.id },
    data: {
      notes,
      priority,
      dueDate
    }
  });

  try {
    await updateHubSpotTask(updatedTask);
  } catch (error) {
    console.error('HubSpot task sync failed after slash modal submit', error);
  }

  await client.chat.postEphemeral({
    channel: metadata.channelId,
    user: body.user.id,
    text: `Created task "${updatedTask.title}"`,
    blocks: taskCreatedEphemeralBlocks(updatedTask)
  });

  await sendTaskCreatedDm(updatedTask as any, body.user.id);
});

app.event('reaction_added', async ({ event }) => {
  if (event.reaction !== env.TODO_REACTION) {
    return;
  }

  if (event.item.type !== 'message') {
    return;
  }

  const channelId = event.item.channel;
  const sourceTs = event.item.ts;

  const history = await app.client.conversations.history({
    channel: channelId,
    latest: sourceTs,
    inclusive: true,
    limit: 1
  });

  const message = history.messages?.[0];
  if (!message || !('text' in message) || !message.text) {
    return;
  }

  const existing = await prisma.task.findFirst({
    where: {
      creatorChannelId: channelId,
      sourceMessageTs: sourceTs,
      createdByUserId: event.user
    }
  });

  if (existing) {
    return;
  }

  const task = await createTaskFromMessage({
    channelId,
    userId: event.user,
    text: message.text,
    sourceTs,
    threadTs: ('thread_ts' in message && typeof message.thread_ts === 'string') ? message.thread_ts : sourceTs
  });

  await app.client.chat.postEphemeral({
    channel: channelId,
    user: event.user,
    text: `Created task "${task.title}" from reaction`,
    blocks: taskCreatedEphemeralBlocks(task)
  });
});

app.action('task_mark_done', async ({ ack, body, action, client }) => {
  await ack();
  const taskId = Number('value' in action && typeof action.value === 'string' ? action.value : '0');
  const task = await updateTaskStatus(taskId, TaskStatus.DONE);
  const channel = ('channel' in body && body.channel?.id) ? body.channel.id : task.creatorChannelId;
  const userId = body.user.id;

  await client.chat.postEphemeral({
    channel,
    user: userId,
    text: `✅ Task "${task.title}" marked as done`
  });
});

app.action('clear_ephemeral_message', async ({ ack, respond }) => {
  await ack();
  await respond({
    delete_original: true
  });
});

app.action('task_open_priority_modal', async ({ ack, body, action, client }) => {
  await ack();
  if (!('trigger_id' in body) || typeof body.trigger_id !== 'string') return;
  const taskId = Number('value' in action && typeof action.value === 'string' ? action.value : '0');
  await client.views.open({
    trigger_id: body.trigger_id,
    view: buildPriorityModal(taskId)
  });
});

app.action('task_open_due_date_modal', async ({ ack, body, action, client }) => {
  await ack();
  if (!('trigger_id' in body) || typeof body.trigger_id !== 'string') return;
  const taskId = Number('value' in action && typeof action.value === 'string' ? action.value : '0');
  await client.views.open({
    trigger_id: body.trigger_id,
    view: buildDueDateModal(taskId)
  });
});

app.view('task_priority_modal_submit', async ({ ack, view, body, client }) => {
  await ack();
  const { taskId } = JSON.parse(view.private_metadata) as { taskId: number };
  const priority = view.state.values.priority.value.selected_option?.value as TaskPriority;
  const task = await updateTaskPriority(taskId, priority);
  await client.chat.postEphemeral({
    channel: task.creatorChannelId,
    user: body.user.id,
    text: `Updated task "${task.title}" priority to ${task.priority}.`,
    blocks: singleTaskBlocks(task)
  });
});

app.view('task_due_date_modal_submit', async ({ ack, view, body, client }) => {
  await ack();
  const { taskId } = JSON.parse(view.private_metadata) as { taskId: number };
  const date = view.state.values.due_date.value.selected_date;
  const hourRaw = view.state.values.due_time?.value?.value;
  const parsedHour = hourRaw ? Number(hourRaw) : env.DEFAULT_REMINDER_HOUR;
  const hour = Number.isFinite(parsedHour)
    ? Math.min(23, Math.max(0, parsedHour))
    : env.DEFAULT_REMINDER_HOUR;
  const due = date
    ? dayjs.tz(`${date} ${String(hour).padStart(2, '0')}:00`, 'YYYY-MM-DD HH:mm', env.TIMEZONE).toDate()
    : null;
  const task = await updateTaskDueDate(taskId, due);
  await client.chat.postEphemeral({
    channel: task.creatorChannelId,
    user: body.user.id,
    text: `Updated due date for "${task.title}".`,
    blocks: singleTaskBlocks(task)
  });
});

async function start() {
  await app.start();
  console.log('⚡️ Creator Tasks Slack app is running');
}

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

start().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
