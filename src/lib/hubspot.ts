import { ChannelLink, Task, TaskPriority, TaskStatus } from '@prisma/client';
import { env } from './env';
import { prisma } from './db';

type HubSpotCompany = {
  id: string;
  properties?: {
    name?: string;
    hs_name?: string;
  };
};

type HubSpotOwner = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  archived?: boolean;
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

function normalizeWords(input?: string | null): string {
  return (input ?? '')
    .toLowerCase()
    .replace(/^whop-x-/, '')
    .replace(/^whop-/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
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

  const rawWords = base.split(/[-_ ]+/).filter(Boolean);
  const titleCase = rawWords
    .map((word) => {
      if (!word) return word;
      if (word.toLowerCase() === 'ai') return 'AI';
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');

  const compact = rawWords.join('');

  return Array.from(new Set([
    base,
    base.replace(/[-_]+/g, ' '),
    titleCase,
    compact
  ]));
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

async function getSavedChannelLink(channelId?: string | null): Promise<ChannelLink | null> {
  if (!channelId) return null;
  return prisma.channelLink.findUnique({ where: { slackChannelId: channelId } });
}

export async function saveChannelLink(args: {
  slackChannelId: string;
  slackChannelName?: string | null;
  hubspotCompanyId: string;
  hubspotCompanyName?: string | null;
}): Promise<ChannelLink> {
  return prisma.channelLink.upsert({
    where: { slackChannelId: args.slackChannelId },
    update: {
      slackChannelName: args.slackChannelName ?? undefined,
      hubspotCompanyId: args.hubspotCompanyId,
      hubspotCompanyName: args.hubspotCompanyName ?? undefined
    },
    create: {
      slackChannelId: args.slackChannelId,
      slackChannelName: args.slackChannelName ?? undefined,
      hubspotCompanyId: args.hubspotCompanyId,
      hubspotCompanyName: args.hubspotCompanyName ?? undefined
    }
  });
}

async function getCompanyById(id: string): Promise<HubSpotCompany | null> {
  if (!enabled()) return null;
  const company = await hubspotFetch<HubSpotCompany>(`/crm/v3/objects/companies/${id}?properties=name,hs_name`, {
    method: 'GET'
  });
  return company;
}

export async function searchCompanies(query: string): Promise<HubSpotCompany[]> {
  if (!enabled()) return [];
  const result = await hubspotFetch<{ results: HubSpotCompany[] }>(`/crm/v3/objects/companies/search`, {
    method: 'POST',
    body: JSON.stringify({
      query,
      properties: ['name', 'hs_name'],
      limit: 10
    })
  });
  return result.results ?? [];
}

function companyScore(company: HubSpotCompany, targetChannelName?: string | null): number {
  const companyName = company.properties?.name ?? company.properties?.hs_name ?? '';
  const targetCompact = normalizeForMatch(targetChannelName);
  const targetWords = normalizeWords(targetChannelName);
  const companyCompact = normalizeForMatch(companyName);
  const companyWords = normalizeWords(companyName);

  let score = 0;
  if (companyCompact === targetCompact) score += 100;
  if (companyWords === targetWords) score += 90;
  if (companyCompact.includes(targetCompact) || targetCompact.includes(companyCompact)) score += 50;

  const targetTokens = new Set(targetWords.split(' ').filter(Boolean));
  const companyTokens = new Set(companyWords.split(' ').filter(Boolean));
  let overlap = 0;
  for (const token of targetTokens) {
    if (companyTokens.has(token)) overlap += 1;
  }
  score += overlap * 10;
  return score;
}

export async function findCompanyForChannel(args: { channelId?: string | null; channelName?: string | null }): Promise<HubSpotCompany | null> {
  if (!enabled()) return null;

  const saved = await getSavedChannelLink(args.channelId);
  if (saved) {
    return {
      id: saved.hubspotCompanyId,
      properties: { name: saved.hubspotCompanyName ?? undefined, hs_name: saved.hubspotCompanyName ?? undefined }
    };
  }

  const channelName = args.channelName;
  if (!channelName) return null;

  const overrides = getOverrides();
  const overrideValue = overrides[channelName] ?? overrides[normalizeForMatch(channelName)];
  if (overrideValue) {
    if (/^\d+$/.test(overrideValue)) {
      const company = await getCompanyById(overrideValue);
      if (company && args.channelId) {
        await saveChannelLink({
          slackChannelId: args.channelId,
          slackChannelName: channelName,
          hubspotCompanyId: company.id,
          hubspotCompanyName: company.properties?.name ?? company.properties?.hs_name
        });
      }
      return company;
    }

    const results = await searchCompanies(overrideValue);
    const company = results[0] ?? null;
    if (company && args.channelId) {
      await saveChannelLink({
        slackChannelId: args.channelId,
        slackChannelName: channelName,
        hubspotCompanyId: company.id,
        hubspotCompanyName: company.properties?.name ?? company.properties?.hs_name
      });
    }
    return company;
  }

  const searchTerms = deriveCompanySearchTerms(channelName);
  let best: HubSpotCompany | null = null;
  let bestScore = -1;

  for (const term of searchTerms) {
    const result = await hubspotFetch<{ results: HubSpotCompany[] }>(`/crm/v3/objects/companies/search`, {
      method: 'POST',
      body: JSON.stringify({
        query: term,
        properties: ['name', 'hs_name'],
        limit: 10
      })
    });

    for (const company of result.results ?? []) {
      const score = companyScore(company, channelName);
      if (score > bestScore) {
        best = company;
        bestScore = score;
      }
    }
  }

  if (best && args.channelId) {
    await saveChannelLink({
      slackChannelId: args.channelId,
      slackChannelName: channelName,
      hubspotCompanyId: best.id,
      hubspotCompanyName: best.properties?.name ?? best.properties?.hs_name
    });
  }

  return best;
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

let ownerCache: { email: string; id: string } | null = null;

export async function resolveHubSpotOwnerId(): Promise<string | undefined> {
  if (!enabled()) return undefined;
  if (env.HUBSPOT_OWNER_ID) return env.HUBSPOT_OWNER_ID;
  if (!env.HUBSPOT_OWNER_EMAIL) return undefined;

  if (ownerCache && ownerCache.email.toLowerCase() === env.HUBSPOT_OWNER_EMAIL.toLowerCase()) {
    return ownerCache.id;
  }

  const owners = await hubspotFetch<{ results: HubSpotOwner[] }>(`/crm/v3/owners`, { method: 'GET' });
  const match = (owners.results ?? []).find((owner) => (owner.email ?? '').toLowerCase() === env.HUBSPOT_OWNER_EMAIL?.toLowerCase());
  if (match?.id) {
    ownerCache = { email: env.HUBSPOT_OWNER_EMAIL, id: match.id };
    return match.id;
  }

  return undefined;
}

export async function createHubSpotTask(task: Task): Promise<{ hubspotTaskId: string; hubspotCompanyId?: string; hubspotCompanyName?: string } | null> {
  if (!enabled()) return null;

  const company = await findCompanyForChannel({ channelId: task.creatorChannelId, channelName: task.creatorChannelName });
  const ownerId = await resolveHubSpotOwnerId();

  const payload: Record<string, unknown> = {
    engagement: {
      active: true,
      type: 'TASK',
      timestamp: taskTimestamp(task),
      ...(ownerId ? { ownerId: Number(ownerId) } : {})
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
  const ownerId = await resolveHubSpotOwnerId();

  await hubspotFetch(`/engagements/v1/engagements/${task.hubspotTaskId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      engagement: {
        active: true,
        type: 'TASK',
        timestamp: taskTimestamp(task),
        ...(ownerId ? { ownerId: Number(ownerId) } : {})
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