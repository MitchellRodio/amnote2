import { App } from '@slack/bolt';
import cron from 'node-cron';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { taskListBlocks } from '../blocks/taskBlocks';
import { env } from './env';
import { listTasksDueTodayForUser, listUsersWithTasksDueToday } from './tasks';

dayjs.extend(utc);
dayjs.extend(timezone);

async function sendDueTodayReminder(app: App, mode: 'morning' | 'afternoon') {
  const userIds = await listUsersWithTasksDueToday();

  for (const userId of userIds) {
    const tasks = await listTasksDueTodayForUser(userId);
    if (!tasks.length) continue;

    const dm = await app.client.conversations.open({ users: userId });
    const channelId = dm.channel?.id;
    if (!channelId) continue;

    const dateLabel = dayjs().tz(env.TIMEZONE).format('MMM D');
    const title = mode === 'morning' ? `Tasks Due Today, ${dateLabel}` : `Still Left To Be Done Today, ${dateLabel}`;
    const text = mode === 'morning'
      ? `Here are the tasks that are due today.`
      : `Here’s what’s still left to be done for today.`;

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
