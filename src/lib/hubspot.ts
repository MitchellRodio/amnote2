import { Task, TaskPriority, TaskStatus } from '@prisma/client';
import { env } from './env';

type HubSpotCompany = {
  id: string;
  properties?: {
    name?: string;
    hs_name?: string;
  };
};

type HubSpotAssociationLabel = {
  typeId: number;
  label?: string | null;
  category?: string;
};

const COMPANY_ASSOCIATION_CACHE: { value?: number } = {};

function enabled(): boolean {
  return Boolean(env.HUBSPOT_ACCESS_TOKEN);
}

function headers(): Record<string, string> {
  if (!env.HUBSPOT_ACCESS_TOKEN) {
    throw new Error('HUBSPOT_ACCESS_TOKEN is not configured');
  }

  return {
    Authorization: `Bearer ${env.HUBSPOT_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
}

function normalizeForMatch(input?: string | null): string {
  return (input ?? '')
    .toLowerCase()
    .replace(/^whop-x-/, '')
    .replace(/^whop-/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '');
}

export function deriveCompanySearchTerms(channelName?: string | null): string[] {
  if (!channelName) return [];

  const prefixes = env.HUBSPOT_CHANNEL_PREFIXES.split(',').map((item) => item.trim()).filter(Boolean);
  let stripped = channelName;
  for (const prefix of prefixes) {
    if (stripped.startsWith(prefix)) {
      stripped = stripped.slice(prefix.length);
      break;
    }
  }

  const base = stripped.replace(/^[-_]+/, '').trim();
  if (!base) return [];

  const rawWords = base.split(/[-_]+/).filter(Boolean);
  const titleCase = rawWords
    .map((word) => {
      if (!word) return word;
      if (word.toLowerCase() === 'ai') return 'AI';
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');

  return Array.from(new Set([base, base.replace(/[-_]+/g, ' '), titleCase]));
}

async function hubspotFetch<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${env.HUBSPOT_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...headers(),
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HubSpot ${init.method ?? 'GET'} ${path} failed: ${response.status} ${body}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function getOverrides(): Record<string, string> {
  try {
    return JSON.parse(env.HUBSPOT_COMPANY_OVERRIDES);
  } catch {
    return {};
  }
}

export async function findCompanyForChannel(channelName?: string | null): Promise<HubSpotCompany | null> {
  if (!enabled()) return null;
  if (!channelName) return null;

  const overrides = getOverrides();
  const overrideValue = overrides[channelName] ?? overrides[normalizeForMatch(channelName)];
  if (overrideValue) {
    if (/^\d+$/.test(overrideValue)) {
      const company = await hubspotFetch<{ id: string; properties?: { name?: string; hs_name?: string } }>(`/crm/v3/objects/companies/${overrideValue}?properties=name,hs_name`, {
        method: 'GET'
      });
      return company;
    }

    return { id: '', properties: { name: overrideValue, hs_name: overrideValue } };
  }

  const searchTerms = deriveCompanySearchTerms(channelName);
  const target = normalizeForMatch(channelName);

  for (const term of searchTerms) {
    const payload = {
      query: term,
      properties: ['name', 'hs_name'],
      limit: 10
    };

    const result = await hubspotFetch<{ results: HubSpotCompany[] }>(`/crm/objects/2026-03/companies/search`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const best = result.results.find((company) => {
      const name = company.properties?.name ?? company.properties?.hs_name ?? '';
      return normalizeForMatch(name) === target || normalizeForMatch(name) === normalizeForMatch(term);
    }) ?? result.results[0];

    if (best) {
      return best;
    }
  }

  return null;
}

async function getTaskToCompanyAssociationTypeId(): Promise<number> {
  if (COMPANY_ASSOCIATION_CACHE.value) {
    return COMPANY_ASSOCIATION_CACHE.value;
  }

  const labels = await hubspotFetch<{ results: HubSpotAssociationLabel[] }>(`/crm/v4/associations/task/company/labels`, {
    method: 'GET'
  });

  const match = labels.results.find((item) => item.label == null) ?? labels.results[0];
  if (!match) {
    throw new Error('Could not resolve HubSpot task→company association type');
  }

  COMPANY_ASSOCIATION_CACHE.value = match.typeId;
  return match.typeId;
}

function mapPriority(priority: TaskPriority): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (priority === TaskPriority.HIGH) return 'HIGH';
  if (priority === TaskPriority.LOW) return 'LOW';
  return 'MEDIUM';
}

function mapStatus(status: TaskStatus): 'COMPLETED' | 'NOT_STARTED' {
  return status === TaskStatus.DONE ? 'COMPLETED' : 'NOT_STARTED';
}

function taskTimestamp(task: Pick<Task, 'dueDate' | 'createdAt'>): string {
  return (task.dueDate ?? task.createdAt).toISOString();
}

export async function createHubSpotTask(task: Task): Promise<{ hubspotTaskId: string; hubspotCompanyId?: string; hubspotCompanyName?: string } | null> {
  if (!enabled()) return null;

  const company = await findCompanyForChannel(task.creatorChannelName);
  const associationTypeId = company?.id ? await getTaskToCompanyAssociationTypeId() : null;

  const properties: Record<string, string> = {
    hs_timestamp: taskTimestamp(task),
    hs_task_subject: task.title,
    hs_task_status: mapStatus(task.status),
    hs_task_priority: mapPriority(task.priority),
    hs_task_type: 'TODO'
  };

  const noteParts = [
    task.notes,
    task.contextSnippet ? `Context: ${task.contextSnippet}` : undefined,
    task.sourceMessageLink ? `Slack source: ${task.sourceMessageLink}` : undefined,
    task.creatorChannelName ? `Slack channel: #${task.creatorChannelName}` : undefined
  ].filter(Boolean);

  if (noteParts.length) {
    properties.hs_task_body = noteParts.join('\n\n');
  }

  const payload: Record<string, unknown> = { properties };

  if (company?.id && associationTypeId) {
    payload.associations = [
      {
        to: { id: company.id },
        types: [
          {
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId
          }
        ]
      }
    ];
  }

  const created = await hubspotFetch<{ id: string }>(`/crm/v3/objects/tasks`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  return {
    hubspotTaskId: created.id,
    hubspotCompanyId: company?.id,
    hubspotCompanyName: company?.properties?.name ?? company?.properties?.hs_name
  };
}

export async function updateHubSpotTask(task: Task): Promise<void> {
  if (!enabled() || !task.hubspotTaskId) return;

  const properties: Record<string, string> = {
    hs_timestamp: taskTimestamp(task),
    hs_task_subject: task.title,
    hs_task_status: mapStatus(task.status),
    hs_task_priority: mapPriority(task.priority)
  };

  const noteParts = [
    task.notes,
    task.contextSnippet ? `Context: ${task.contextSnippet}` : undefined,
    task.sourceMessageLink ? `Slack source: ${task.sourceMessageLink}` : undefined,
    task.creatorChannelName ? `Slack channel: #${task.creatorChannelName}` : undefined
  ].filter(Boolean);

  properties.hs_task_body = noteParts.join('\n\n');

  await hubspotFetch(`/crm/v3/objects/tasks/${task.hubspotTaskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties })
  });
}
