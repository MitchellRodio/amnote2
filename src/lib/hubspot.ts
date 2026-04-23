import { Task, TaskPriority, TaskStatus } from '@prisma/client';
import { env } from './env';

type HubSpotCompany = {
  id: string;
  properties?: {
    name?: string;
    hs_name?: string;
  };
};

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

    const result = await hubspotFetch<{ results: HubSpotCompany[] }>(`/crm/v3/objects/companies/search`, {
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

function mapPriority(priority: TaskPriority): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (priority === TaskPriority.HIGH) return 'HIGH';
  if (priority === TaskPriority.LOW) return 'LOW';
  return 'MEDIUM';
}

function mapStatus(status: TaskStatus): 'COMPLETED' | 'NOT_STARTED' {
  return status === TaskStatus.DONE ? 'COMPLETED' : 'NOT_STARTED';
}

function taskTimestamp(task: Pick<Task, 'dueDate' | 'createdAt'>): number {
  return (task.dueDate ?? task.createdAt).getTime();
}

function buildTaskBody(task: Task): string {
  return [
    task.notes,
    task.contextSnippet ? `Context: ${task.contextSnippet}` : undefined,
    task.sourceMessageLink ? `Slack source: ${task.sourceMessageLink}` : undefined,
    task.creatorChannelName ? `Slack channel: #${task.creatorChannelName}` : undefined
  ].filter(Boolean).join('\n\n');
}

export async function createHubSpotTask(task: Task): Promise<{ hubspotTaskId: string; hubspotCompanyId?: string; hubspotCompanyName?: string } | null> {
  if (!enabled()) return null;

  const company = await findCompanyForChannel(task.creatorChannelName);

  const payload: Record<string, unknown> = {
    engagement: {
      active: true,
      type: 'TASK',
      timestamp: taskTimestamp(task)
    },
    associations: {
      companyIds: company?.id ? [Number(company.id)] : []
    },
    attachments: [],
    metadata: {
      subject: task.title,
      body: buildTaskBody(task) || 'Created from Slack',
      status: mapStatus(task.status),
      priority: mapPriority(task.priority)
    }
  };

  const created = await hubspotFetch<{ engagement: { id: number | string } }>(`/engagements/v1/engagements`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  return {
    hubspotTaskId: String(created.engagement.id),
    hubspotCompanyId: company?.id,
    hubspotCompanyName: company?.properties?.name ?? company?.properties?.hs_name
  };
}

export async function updateHubSpotTask(task: Task): Promise<void> {
  if (!enabled() || !task.hubspotTaskId) return;

  await hubspotFetch(`/engagements/v1/engagements/${task.hubspotTaskId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      engagement: {
        active: true,
        type: 'TASK',
        timestamp: taskTimestamp(task)
      },
      metadata: {
        subject: task.title,
        body: buildTaskBody(task) || 'Created from Slack',
        status: mapStatus(task.status),
        priority: mapPriority(task.priority)
      }
    })
  });
}
