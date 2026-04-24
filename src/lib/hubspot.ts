import { env } from './env';
import { HubSpotTask, TaskPriority } from '../types/domain';

export type HubSpotOwner = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  archived?: boolean;
};

export type HubSpotCompany = {
  id: string;
  properties?: {
    name?: string;
    hs_name?: string;
    domain?: string;
  };
};

type SlackChannelLink = {
  id: string;
  channelId: string;
  channelName?: string;
  companyId: string;
  companyName?: string;
};

export function hubSpotOwnerDisplayName(owner: HubSpotOwner): string {
  const name = [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim();
  return name || owner.email || `HubSpot owner ${owner.id}`;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.HUBSPOT_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
}

async function hubspotFetch<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${env.HUBSPOT_BASE_URL}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers ?? {}) }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HubSpot ${init.method ?? 'GET'} ${path} failed: ${response.status} ${body}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

let ownersCache: { fetchedAt: number; owners: HubSpotOwner[] } | null = null;

export async function listHubSpotOwners(): Promise<HubSpotOwner[]> {
  const now = Date.now();
  if (ownersCache && now - ownersCache.fetchedAt < 5 * 60 * 1000) return ownersCache.owners;

  const result = await hubspotFetch<{ results: HubSpotOwner[] }>(`/crm/v3/owners?limit=500`, { method: 'GET' });
  const owners = (result.results ?? [])
    .filter((owner) => !owner.archived)
    .sort((a, b) => hubSpotOwnerDisplayName(a).localeCompare(hubSpotOwnerDisplayName(b)));

  ownersCache = { fetchedAt: now, owners };
  return owners;
}

export async function findHubSpotOwnerByEmail(email: string): Promise<HubSpotOwner | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  const owners = await listHubSpotOwners();
  return owners.find((owner) => (owner.email ?? '').toLowerCase() === target) ?? null;
}

export async function findHubSpotOwnerById(ownerId?: string | null): Promise<HubSpotOwner | null> {
  if (!ownerId) return null;
  const owners = await listHubSpotOwners();
  return owners.find((owner) => owner.id === ownerId) ?? null;
}

export async function searchCompanies(query: string): Promise<HubSpotCompany[]> {
  const result = await hubspotFetch<{ results: HubSpotCompany[] }>(`/crm/v3/objects/companies/search`, {
    method: 'POST',
    body: JSON.stringify({
      query,
      properties: ['name', 'hs_name', 'domain'],
      limit: 3
    })
  });
  return result.results ?? [];
}

export async function getCompanyById(companyId: string): Promise<HubSpotCompany | null> {
  try {
    return await hubspotFetch<HubSpotCompany>(`/crm/v3/objects/companies/${companyId}?properties=name,hs_name,domain`, { method: 'GET' });
  } catch {
    return null;
  }
}

export async function findSlackChannelLink(channelId: string): Promise<SlackChannelLink | null> {
  const result = await hubspotFetch<{ results: any[] }>(`/crm/v3/objects/${env.HUBSPOT_SLACK_CHANNEL_OBJECT_TYPE}/search`, {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'channel_id', operator: 'EQ', value: channelId }] }],
      properties: ['channel_id', 'channel_name', 'company_id'],
      limit: 1
    })
  });

  const row = result.results?.[0];
  if (!row) return null;

  const companyId = row.properties?.company_id;
  const company = companyId ? await getCompanyById(companyId) : null;
  return {
    id: row.id,
    channelId: row.properties?.channel_id ?? channelId,
    channelName: row.properties?.channel_name,
    companyId,
    companyName: company?.properties?.name ?? company?.properties?.hs_name
  };
}

export async function upsertSlackChannelLink(args: {
  channelId: string;
  channelName?: string | null;
  companyId: string;
  companyName?: string | null;
}): Promise<SlackChannelLink> {
  const existing = await findSlackChannelLink(args.channelId);
  const properties = {
    channel_id: args.channelId,
    channel_name: args.channelName ?? '',
    company_id: args.companyId
  };

  if (existing) {
    await hubspotFetch(`/crm/v3/objects/${env.HUBSPOT_SLACK_CHANNEL_OBJECT_TYPE}/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties })
    });
    return { ...existing, channelName: args.channelName ?? undefined, companyId: args.companyId, companyName: args.companyName ?? undefined };
  }

  const created = await hubspotFetch<{ id: string }>(`/crm/v3/objects/${env.HUBSPOT_SLACK_CHANNEL_OBJECT_TYPE}`, {
    method: 'POST',
    body: JSON.stringify({ properties })
  });

  if (env.HUBSPOT_SLACK_CHANNEL_TO_COMPANY_ASSOCIATION_TYPE_ID) {
    await hubspotFetch(`/crm/v4/objects/${env.HUBSPOT_SLACK_CHANNEL_OBJECT_TYPE}/${created.id}/associations/companies/${args.companyId}`, {
      method: 'PUT',
      body: JSON.stringify([{ associationCategory: 'USER_DEFINED', associationTypeId: env.HUBSPOT_SLACK_CHANNEL_TO_COMPANY_ASSOCIATION_TYPE_ID }])
    }).catch(() => undefined);
  }

  return {
    id: created.id,
    channelId: args.channelId,
    channelName: args.channelName ?? undefined,
    companyId: args.companyId,
    companyName: args.companyName ?? undefined
  };
}

function priorityToHubSpot(priority: TaskPriority): 'LOW' | 'MEDIUM' | 'HIGH' {
  return priority;
}

function hubSpotPriority(priority?: string): TaskPriority {
  if (priority === 'LOW' || priority === 'HIGH') return priority;
  return 'MEDIUM';
}

function dateFromMs(value?: string | null): Date | null {
  if (!value) return null;
  const num = Number(value);
  return Number.isFinite(num) ? new Date(num) : null;
}

function taskFromRow(row: any): HubSpotTask {
  const props = row.properties ?? {};
  return {
    id: row.id,
    title: props.hs_task_subject ?? 'Untitled task',
    status: props.hs_task_status === 'COMPLETED' ? 'DONE' : 'OPEN',
    priority: hubSpotPriority(props.hs_task_priority),
    dueDate: dateFromMs(props.hs_timestamp),
    notes: props.hs_task_body,
    slackChannelId: props.slack_channel_id,
    slackChannelName: props.slack_channel_name,
    slackUserId: props.slack_user_id,
    sourceMessageLink: props.slack_source_message_link,
    contextSnippet: props.slack_context_snippet,
    hubspotOwnerId: props.hubspot_owner_id,
    hubspotCompanyId: props.hubspot_company_id,
    hubspotCompanyName: props.hubspot_company_name,
    createdAt: props.createdate ? new Date(props.createdate) : null
  };
}

function taskProperties(): string[] {
  return [
    'hs_task_subject',
    'hs_task_body',
    'hs_task_status',
    'hs_task_priority',
    'hs_timestamp',
    'hubspot_owner_id',
    'slack_channel_id',
    'slack_channel_name',
    'slack_user_id',
    'slack_source_message_link',
    'slack_context_snippet',
    'hubspot_company_id',
    'hubspot_company_name',
    'createdate'
  ];
}

export async function createHubSpotTask(input: {
  title: string;
  notes?: string;
  priority: TaskPriority;
  dueDate?: Date | null;
  owner: HubSpotOwner;
  slackChannelId: string;
  slackChannelName?: string | null;
  slackUserId: string;
  sourceMessageLink?: string;
  contextSnippet?: string;
  companyId: string;
  companyName?: string | null;
}): Promise<HubSpotTask> {
  const body = [
    input.notes,
    input.contextSnippet ? `Context: ${input.contextSnippet}` : undefined,
    input.sourceMessageLink ? `Slack source: ${input.sourceMessageLink}` : undefined,
    input.slackChannelName ? `Slack channel: #${input.slackChannelName}` : undefined
  ].filter(Boolean).join('\n\n') || 'Created from Slack';

  const created = await hubspotFetch<any>(`/crm/v3/objects/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        hs_task_subject: input.title,
        hs_task_body: body,
        hs_task_status: 'NOT_STARTED',
        hs_task_priority: priorityToHubSpot(input.priority),
        hs_timestamp: String((input.dueDate ?? new Date()).getTime()),
        hubspot_owner_id: input.owner.id,
        slack_channel_id: input.slackChannelId,
        slack_channel_name: input.slackChannelName ?? '',
        slack_user_id: input.slackUserId,
        slack_source_message_link: input.sourceMessageLink ?? '',
        slack_context_snippet: input.contextSnippet ?? '',
        hubspot_company_id: input.companyId,
        hubspot_company_name: input.companyName ?? ''
      },
      associations: [{
        to: { id: input.companyId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: env.HUBSPOT_TASK_TO_COMPANY_ASSOCIATION_TYPE_ID }]
      }]
    })
  });

  const task = taskFromRow(created);
  task.hubspotOwnerName = hubSpotOwnerDisplayName(input.owner);
  task.hubspotOwnerEmail = input.owner.email;
  return task;
}

export async function getHubSpotTask(taskId: string): Promise<HubSpotTask> {
  const row = await hubspotFetch<any>(`/crm/v3/objects/tasks/${taskId}?properties=${taskProperties().join(',')}`, { method: 'GET' });
  const task = taskFromRow(row);
  if (task.hubspotOwnerId) {
    const owner = await findHubSpotOwnerById(task.hubspotOwnerId);
    task.hubspotOwnerName = owner ? hubSpotOwnerDisplayName(owner) : undefined;
    task.hubspotOwnerEmail = owner?.email;
  }
  return task;
}

export async function updateHubSpotTaskStatus(taskId: string, done: boolean): Promise<HubSpotTask> {
  await hubspotFetch(`/crm/v3/objects/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: { hs_task_status: done ? 'COMPLETED' : 'NOT_STARTED' } })
  });
  return getHubSpotTask(taskId);
}

export async function updateHubSpotTaskPriority(taskId: string, priority: TaskPriority): Promise<HubSpotTask> {
  await hubspotFetch(`/crm/v3/objects/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: { hs_task_priority: priorityToHubSpot(priority) } })
  });
  return getHubSpotTask(taskId);
}

export async function updateHubSpotTaskDueDate(taskId: string, dueDate: Date | null): Promise<HubSpotTask> {
  await hubspotFetch(`/crm/v3/objects/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: { hs_timestamp: dueDate ? String(dueDate.getTime()) : String(Date.now()) } })
  });
  return getHubSpotTask(taskId);
}

export async function searchOpenHubSpotTasks(filters: { ownerId: string; slackChannelId?: string }): Promise<HubSpotTask[]> {
  const filterGroups = [{
    filters: [
      { propertyName: 'hubspot_owner_id', operator: 'EQ', value: filters.ownerId },
      { propertyName: 'hs_task_status', operator: 'NEQ', value: 'COMPLETED' },
      ...(filters.slackChannelId ? [{ propertyName: 'slack_channel_id', operator: 'EQ', value: filters.slackChannelId }] : [])
    ]
  }];

  const result = await hubspotFetch<{ results: any[] }>(`/crm/v3/objects/tasks/search`, {
    method: 'POST',
    body: JSON.stringify({
      filterGroups,
      properties: taskProperties(),
      sorts: ['hs_timestamp'],
      limit: 100
    })
  });

  const tasks = (result.results ?? []).map(taskFromRow);
  const owners = await listHubSpotOwners();
  for (const task of tasks) {
    const owner = owners.find((o) => o.id === task.hubspotOwnerId);
    task.hubspotOwnerName = owner ? hubSpotOwnerDisplayName(owner) : undefined;
    task.hubspotOwnerEmail = owner?.email;
  }
  return tasks;
}
