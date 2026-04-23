import fetch from 'node-fetch';

const HUBSPOT_BASE_URL = process.env.HUBSPOT_BASE_URL!;
const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

export async function createHubspotTask({
  title,
  notes,
  dueDate,
  companyId,
}: {
  title: string;
  notes?: string;
  dueDate?: Date | null;
  companyId?: number | null;
}) {
  const response = await fetch(`${HUBSPOT_BASE_URL}/engagements/v1/engagements`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      engagement: {
        active: true,
        type: 'TASK',
        timestamp: dueDate ? new Date(dueDate).getTime() : Date.now(),
      },
      associations: {
        companyIds: companyId ? [companyId] : [],
      },
      attachments: [],
      metadata: {
        subject: title,
        body: notes || 'Created from Slack',
        status: 'NOT_STARTED',
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('HubSpot create error:', data);
    throw new Error('Failed to create HubSpot task');
  }

  return data.engagement.id;
}

export async function completeHubspotTask(hubspotId: number) {
  const response = await fetch(
    `${HUBSPOT_BASE_URL}/engagements/v1/engagements/${hubspotId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        metadata: {
          status: 'COMPLETED',
        },
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error('HubSpot update error:', data);
    throw new Error('Failed to update HubSpot task');
  }
}