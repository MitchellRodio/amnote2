import { App } from '@slack/bolt';
import cron from 'node-cron';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { taskListBlocks } from '../blocks/taskBlocks';
import { env } from './env';
import { listTasksDueTodayForHubSpotOwner } from './tasks';
import { listReminderEnabledUserAccountLinks } from './hubspot';

dayjs.extend(utc);
dayjs.extend(timezone);

async function sendDueTodayReminder(app: App, mode: 'morning' | 'afternoon') {
  const linkedUsers = await listReminderEnabledUserAccountLinks();

  for (const linkedUser of linkedUsers) {
    const tasks = await listTasksDueTodayForHubSpotOwner(linkedUser.hubspotOwnerId);
    if (!tasks.length) continue;

    const dm = await app.client.conversations.open({ users: linkedUser.slackUserId });
    const channelId = dm.channel?.id;
    if (!channelId) continue;

    const dateLabel = dayjs().tz(env.TIMEZONE).format('MMM D');
    const ownerLabel = linkedUser.hubspotOwnerName ?? linkedUser.hubspotOwnerEmail ?? linkedUser.hubspotOwnerId;
    const title = mode === 'morning' ? `Tasks Due Today, ${dateLabel}` : `Still Left To Be Done Today, ${dateLabel}`;
    const text = mode === 'morning'
      ? `Here are the tasks due today assigned to your HubSpot owner, *${ownerLabel}*.`
      : `Here’s what’s still left for today assigned to your HubSpot owner, *${ownerLabel}*.`;

    await app.client.chat.postMessage({
      channel: channelId,
      text,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text
          }
        },
        ...taskListBlocks(title, tasks)
      ]
    });
  }
}

export function registerReminderJobs(app: App) {
  cron.schedule(
    '0 9 * * *',
    async () => {
      try {
        await sendDueTodayReminder(app, 'morning');
      } catch (error) {
        console.error('9 AM due-today reminder failed', error);
      }
    },
    { timezone: env.TIMEZONE }
  );

  cron.schedule(
    '0 16 * * *',
    async () => {
      try {
        await sendDueTodayReminder(app, 'afternoon');
      } catch (error) {
        console.error('4 PM due-today reminder failed', error);
      }
    },
    { timezone: env.TIMEZONE }
  );
}
