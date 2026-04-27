import { App, LogLevel } from '@slack/bolt';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { env } from './lib/env';
import { buildCreateTaskModal, buildDueDateModal, buildPriorityModal, buildSlashTodoModal } from './blocks/modals';
import { singleTaskBlocks, taskListBlocks } from './blocks/taskBlocks';
import { fetchContextSnippet } from './lib/context';
import { sanitizeTaskTitle } from './lib/format';
import {
  HubSpotCompany,
  HubSpotOwner,
  createHubSpotTask,
  findHubSpotOwnerByEmail,
  findHubSpotOwnerById,
  findSlackChannelLink,
  getCompanyById,
  hubSpotOwnerDisplayName,
  listHubSpotOwners,
  searchCompanies,
  searchOpenHubSpotTasks,
  updateHubSpotTaskDueDate,
  updateHubSpotTaskPriority,
  updateHubSpotTaskStatus,
  upsertSlackChannelLink
} from './lib/hubspot';
import { HubSpotTask, TaskPriority } from './types/domain';

dayjs.extend(utc);
dayjs.extend(timezone);

const app = new App({
  token: env.SLACK_BOT_TOKEN,
  appToken: env.SLACK_APP_TOKEN,
  socketMode: true,
  signingSecret: env.SLACK_SIGNING_SECRET,
  logLevel: env.SLACK_LOG_LEVEL as LogLevel
});

function json(value: unknown): string {
  return JSON.stringify(value);
}

function taskCreatedEphemeralBlocks(task: HubSpotTask) {
  return [
    ...singleTaskBlocks(task),
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Clear Msg' }, action_id: 'clear_ephemeral_message', value: 'clear' }] }
  ];
}

function listWithClearBlocks(title: string, tasks: HubSpotTask[]) {
  return [
    ...taskListBlocks(title, tasks),
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Clear Msg' }, action_id: 'clear_ephemeral_message', value: 'clear' }] }
  ];
}

async function slackUserEmail(userId: string): Promise<string | undefined> {
  const userInfo = await app.client.users.info({ user: userId });
  const profile = userInfo.user?.profile as { email?: string } | undefined;
  return profile?.email;
}

async function defaultOwnerForSlackUser(userId: string): Promise<HubSpotOwner | null> {
  if (env.HUBSPOT_OWNER_ID) return findHubSpotOwnerById(env.HUBSPOT_OWNER_ID);
  if (env.HUBSPOT_OWNER_EMAIL) return findHubSpotOwnerByEmail(env.HUBSPOT_OWNER_EMAIL);

  const email = await slackUserEmail(userId).catch(() => undefined);
  if (!email) return null;
  return findHubSpotOwnerByEmail(email);
}

async function selectedOrDefaultOwner(selectedOwnerId: string | undefined, slackUserId: string): Promise<HubSpotOwner | null> {
  if (selectedOwnerId) return findHubSpotOwnerById(selectedOwnerId);
  return defaultOwnerForSlackUser(slackUserId);
}

function parseDueDate(date?: string, hourRaw?: string): Date | undefined {
  if (!date) return undefined;
  const parsedHour = hourRaw ? Number(hourRaw) : env.DEFAULT_REMINDER_HOUR;
  const hour = Number.isFinite(parsedHour) ? Math.min(23, Math.max(0, parsedHour)) : env.DEFAULT_REMINDER_HOUR;
  return dayjs.tz(`${date} ${String(hour).padStart(2, '0')}:00`, 'YYYY-MM-DD HH:mm', env.TIMEZONE).toDate();
}

async function createTaskFromInput(args: {
  channelId: string;
  channelName?: string;
  userId: string;
  title: string;
  notes?: string;
  priority?: TaskPriority;
  dueDate?: Date;
  owner?: HubSpotOwner | null;
  sourceTs?: string;
  threadTs?: string;
  contextSnippet?: string;
}): Promise<HubSpotTask> {
  const channelLink = await findSlackChannelLink(args.channelId);
  if (!channelLink?.companyId) {
    throw new Error('CHANNEL_NOT_LINKED');
  }

  const owner = args.owner ?? await defaultOwnerForSlackUser(args.userId);
  if (!owner?.id) {
    throw new Error('OWNER_NOT_FOUND');
  }

  let sourceMessageLink: string | undefined;
  if (args.sourceTs) {
    const permalink = await app.client.chat.getPermalink({ channel: args.channelId, message_ts: args.sourceTs }).catch(() => null);
    sourceMessageLink = permalink?.permalink;
  }

  const contextSnippet = args.contextSnippet ?? (args.threadTs ? await fetchContextSnippet(app, args.channelId, args.threadTs) : undefined);

  return createHubSpotTask({
    title: sanitizeTaskTitle(args.title),
    notes: args.notes,
    priority: args.priority ?? 'MEDIUM',
    dueDate: args.dueDate,
    owner,
    slackChannelId: args.channelId,
    slackChannelName: args.channelName,
    slackUserId: args.userId,
    sourceMessageLink,
    contextSnippet,
    companyId: channelLink.companyId,
    companyName: channelLink.companyName
  });
}

async function sendTaskCreatedDm(task: HubSpotTask, slackUserId: string) {
  try {
    await app.client.chat.postMessage({
      channel: slackUserId,
      text: `Created task "${task.title}"`,
      blocks: singleTaskBlocks(task)
    });
  } catch (error) {
    console.error('Failed to send task DM', error);
  }
}

function companyName(company: HubSpotCompany): string {
  return company.properties?.name ?? company.properties?.hs_name ?? company.id;
}

function companyDomain(company: HubSpotCompany): string | undefined {
  return company.properties?.domain;
}

app.command('/todo', async ({ ack, command, client, respond }) => {
  await ack();

  const channelLink = await findSlackChannelLink(command.channel_id);
  if (!channelLink?.companyId) {
    await respond({ response_type: 'ephemeral', text: 'This channel is not linked to a HubSpot company. Run `/link` first.' });
    return;
  }

  const owners = await listHubSpotOwners().catch(() => []);
  await client.views.open({
    trigger_id: command.trigger_id,
    view: buildSlashTodoModal(json({ channelId: command.channel_id, channelName: command.channel_name, userId: command.user_id, userName: command.user_name }), command.text.trim(), owners)
  });
});

app.command('/link', async ({ ack, command, respond }) => {
  await ack();
  const raw = command.text.trim();
  if (!raw) {
    await respond({ response_type: 'ephemeral', text: 'Use `/link company name` to link this Slack channel to a HubSpot company.' });
    return;
  }

  const matches = /^\d+$/.test(raw)
    ? [await getCompanyById(raw)].filter((company): company is HubSpotCompany => Boolean(company))
    : await searchCompanies(raw);

  if (!matches.length) {
    await respond({ response_type: 'ephemeral', text: `No HubSpot company matches found for "${raw}".` });
    return;
  }

  await respond({
    response_type: 'ephemeral',
    text: 'I found multiple matches. Pick one to confirm.',
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*I found these HubSpot companies for:* ${raw}` } },
      {
        type: 'actions',
        elements: matches.slice(0, 3).map((company, index) => ({
          type: 'button',
          text: { type: 'plain_text', text: `${index + 1}. ${companyName(company)}${companyDomain(company) ? ` (${companyDomain(company)})` : ''}`.slice(0, 75) },
          action_id: 'link_company_select',
          value: json({ channelId: command.channel_id, channelName: command.channel_name, companyId: company.id, companyName: companyName(company) })
        }))
      }
    ]
  });
});

app.action('link_company_select', async ({ ack, action, respond }) => {
  await ack();
  if (!('value' in action) || typeof action.value !== 'string') return;
  const payload = JSON.parse(action.value) as { channelId: string; channelName?: string; companyId: string; companyName: string };
  const existing = await findSlackChannelLink(payload.channelId);

  if (existing?.companyId && existing.companyId !== payload.companyId) {
    await respond({
      replace_original: true,
      response_type: 'ephemeral',
      text: `This channel is already linked to ${existing.companyName ?? existing.companyId}. Replace it?`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `This channel is already linked to *${existing.companyName ?? existing.companyId}*. Replace it with *${payload.companyName}*?` } },
        { type: 'actions', elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Replace link' }, style: 'danger', action_id: 'link_company_replace_confirm', value: action.value },
          { type: 'button', text: { type: 'plain_text', text: 'Cancel' }, action_id: 'clear_ephemeral_message', value: 'clear' }
        ] }
      ]
    });
    return;
  }

  await upsertSlackChannelLink({ channelId: payload.channelId, channelName: payload.channelName, companyId: payload.companyId, companyName: payload.companyName });
  await respond({ replace_original: true, response_type: 'ephemeral', text: `Linked this channel to HubSpot company *${payload.companyName}* (${payload.companyId}).` });
});

app.action('link_company_replace_confirm', async ({ ack, action, respond }) => {
  await ack();
  if (!('value' in action) || typeof action.value !== 'string') return;
  const payload = JSON.parse(action.value) as { channelId: string; channelName?: string; companyId: string; companyName: string };
  await upsertSlackChannelLink({ channelId: payload.channelId, channelName: payload.channelName, companyId: payload.companyId, companyName: payload.companyName });
  await respond({ replace_original: true, response_type: 'ephemeral', text: `Re-linked this channel to HubSpot company *${payload.companyName}* (${payload.companyId}).` });
});

app.command('/list', async ({ ack, command, respond }) => {
  await ack();
  const owner = await defaultOwnerForSlackUser(command.user_id);
  if (!owner?.id) {
    await respond({ response_type: 'ephemeral', text: 'Could not match your Slack email to a HubSpot owner. Make sure Slack email access is enabled or select an owner when creating tasks.' });
    return;
  }
  const tasks = await searchOpenHubSpotTasks({ ownerId: owner.id });
  await respond({ response_type: 'ephemeral', blocks: listWithClearBlocks('My Open Tasks', tasks) });
});

app.command('/mytodos', async ({ ack, command, respond }) => {
  await ack();
  const owner = await defaultOwnerForSlackUser(command.user_id);
  if (!owner?.id) {
    await respond({ response_type: 'ephemeral', text: 'Could not match your Slack email to a HubSpot owner.' });
    return;
  }
  const tasks = await searchOpenHubSpotTasks({ ownerId: owner.id });
  await respond({ response_type: 'ephemeral', blocks: listWithClearBlocks('My Open Tasks', tasks) });
});

app.command('/todos', async ({ ack, command, respond }) => {
  await ack();
  const owner = await defaultOwnerForSlackUser(command.user_id);
  if (!owner?.id) {
    await respond({ response_type: 'ephemeral', text: 'Could not match your Slack email to a HubSpot owner.' });
    return;
  }
  const tasks = await searchOpenHubSpotTasks({ ownerId: owner.id, slackChannelId: command.channel_id });
  await respond({ response_type: 'ephemeral', blocks: listWithClearBlocks(`Tasks for #${command.channel_name}`, tasks) });
});

app.shortcut('create_task_from_message', async ({ ack, shortcut, client }) => {
  await ack();
  if (!('message' in shortcut) || !shortcut.message) return;

  const channelId = shortcut.channel.id;
  const channelLink = await findSlackChannelLink(channelId);
  if (!channelLink?.companyId) {
    await client.chat.postEphemeral({ channel: channelId, user: shortcut.user.id, text: 'This channel is not linked to a HubSpot company. Run `/link` first.' });
    return;
  }

  const owners = await listHubSpotOwners().catch(() => []);
  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: buildCreateTaskModal(json({
      channelId,
      channelName: shortcut.channel.name,
      sourceTs: shortcut.message.ts,
      threadTs: shortcut.message.thread_ts ?? shortcut.message.ts,
      userId: shortcut.user.id,
      userName: shortcut.user.name ?? shortcut.user.username ?? 'Unknown'
    }), sanitizeTaskTitle(shortcut.message.text || 'Follow up'), owners)
  });
});

async function handleTaskModalSubmit(body: any, view: any, client: any, metadata: any) {
  const title = sanitizeTaskTitle(view.state.values.task_title?.value?.value ?? '');
  const notes = view.state.values.task_notes?.value?.value ?? undefined;
  const priority = (view.state.values.priority?.value?.selected_option?.value as TaskPriority | undefined) ?? 'MEDIUM';
  const hubspotOwnerId = view.state.values.hubspot_owner?.value?.selected_option?.value as string | undefined;
  const dueDate = parseDueDate(view.state.values.due_date?.value?.selected_date ?? undefined, view.state.values.due_time?.value?.value ?? undefined);

  if (!title) {
    await client.chat.postEphemeral({ channel: metadata.channelId, user: body.user.id, text: 'Task title is required.' });
    return;
  }

  const owner = await selectedOrDefaultOwner(hubspotOwnerId, metadata.userId);
  if (!owner?.id) {
    await client.chat.postEphemeral({ channel: metadata.channelId, user: body.user.id, text: 'Could not match your Slack email to a HubSpot owner. Pick an owner from the dropdown or enable Slack email access.' });
    return;
  }

  try {
    const task = await createTaskFromInput({
      channelId: metadata.channelId,
      channelName: metadata.channelName,
      userId: metadata.userId,
      title,
      notes,
      priority,
      dueDate,
      owner,
      sourceTs: metadata.sourceTs,
      threadTs: metadata.threadTs
    });

    await client.chat.postEphemeral({ channel: metadata.channelId, user: body.user.id, text: `Created task "${task.title}"`, blocks: taskCreatedEphemeralBlocks(task) });
    await sendTaskCreatedDm(task, metadata.userId);
  } catch (error) {
    const text = error instanceof Error && error.message === 'CHANNEL_NOT_LINKED'
      ? 'This channel is not linked to a HubSpot company. Run `/link` first.'
      : `Could not create task: ${error instanceof Error ? error.message : 'Unknown error'}`;
    await client.chat.postEphemeral({ channel: metadata.channelId, user: body.user.id, text });
  }
}

app.view('create_task_modal_submit', async ({ ack, body, view, client }) => {
  await ack();
  await handleTaskModalSubmit(body, view, client, JSON.parse(view.private_metadata));
});

app.view('slash_todo_modal_submit', async ({ ack, body, view, client }) => {
  await ack();
  await handleTaskModalSubmit(body, view, client, JSON.parse(view.private_metadata));
});

app.event('reaction_added', async ({ event }) => {
  if (event.reaction !== env.TODO_REACTION || event.item.type !== 'message') return;

  const channelId = event.item.channel;
  const sourceTs = event.item.ts;
  const history = await app.client.conversations.history({ channel: channelId, latest: sourceTs, inclusive: true, limit: 1 });
  const message = history.messages?.[0];
  if (!message || !('text' in message) || !message.text) return;

  const channel = await app.client.conversations.info({ channel: channelId }).catch(() => null);
  const channelName = channel?.channel && 'name' in channel.channel ? channel.channel.name : undefined;

  try {
    const task = await createTaskFromInput({
      channelId,
      channelName,
      userId: event.user,
      title: message.text,
      sourceTs,
      threadTs: ('thread_ts' in message && typeof message.thread_ts === 'string') ? message.thread_ts : sourceTs
    });

    await app.client.chat.postEphemeral({ channel: channelId, user: event.user, text: `Created task "${task.title}" from reaction`, blocks: taskCreatedEphemeralBlocks(task) });
  } catch (error) {
    console.error('Reaction task create failed', error);
  }
});

app.action('task_mark_done', async ({ ack, body, action, client }) => {
  await ack();
  const taskId = 'value' in action && typeof action.value === 'string' ? action.value : '';
  if (!taskId) return;
  const task = await updateHubSpotTaskStatus(taskId, true);
  const channel = ('channel' in body && body.channel?.id) ? body.channel.id : task.slackChannelId;
  if (!channel) return;
  await client.chat.postEphemeral({ channel, user: body.user.id, text: `✅ Task "${task.title}" marked as done` });
});

app.action('clear_ephemeral_message', async ({ ack, respond }) => {
  await ack();
  await respond({ delete_original: true });
});

app.action('task_open_priority_modal', async ({ ack, body, action, client }) => {
  await ack();
  if (!('trigger_id' in body) || typeof body.trigger_id !== 'string') return;
  const taskId = 'value' in action && typeof action.value === 'string' ? action.value : '';
  await client.views.open({ trigger_id: body.trigger_id, view: buildPriorityModal(taskId) });
});

app.action('task_open_due_date_modal', async ({ ack, body, action, client }) => {
  await ack();
  if (!('trigger_id' in body) || typeof body.trigger_id !== 'string') return;
  const taskId = 'value' in action && typeof action.value === 'string' ? action.value : '';
  await client.views.open({ trigger_id: body.trigger_id, view: buildDueDateModal(taskId) });
});

app.view('task_priority_modal_submit', async ({ ack, view, body, client }) => {
  await ack();
  const { taskId } = JSON.parse(view.private_metadata) as { taskId: string };
  const priority = view.state.values.priority.value.selected_option?.value as TaskPriority;
  const task = await updateHubSpotTaskPriority(taskId, priority);
  if (!task.slackChannelId) return;
  await client.chat.postEphemeral({ channel: task.slackChannelId, user: body.user.id, text: `Updated task "${task.title}" priority to ${task.priority}.`, blocks: singleTaskBlocks(task) });
});

app.view('task_due_date_modal_submit', async ({ ack, view, body, client }) => {
  await ack();
  const { taskId } = JSON.parse(view.private_metadata) as { taskId: string };
  const due = parseDueDate(view.state.values.due_date.value.selected_date ?? undefined, view.state.values.due_time?.value?.value ?? undefined) ?? null;
  const task = await updateHubSpotTaskDueDate(taskId, due);
  if (!task.slackChannelId) return;
  await client.chat.postEphemeral({ channel: task.slackChannelId, user: body.user.id, text: `Updated due date for "${task.title}".`, blocks: singleTaskBlocks(task) });
});

async function start() {
  await app.start();
  console.log('⚡️ Creator Tasks Slack app is running stateless');
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
