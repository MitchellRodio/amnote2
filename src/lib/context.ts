import { App } from '@slack/bolt';
import { truncate } from './format';

export async function fetchContextSnippet(app: App, channel: string, ts: string): Promise<string | undefined> {
  try {
    const reply = await app.client.conversations.replies({
      channel,
      ts,
      limit: 5
    });

    const messages = reply.messages ?? [];
    const combined = messages
      .map((message) => {
        const text = 'text' in message && typeof message.text === 'string' ? message.text : '';
        return text;
      })
      .filter(Boolean)
      .join(' | ');

    return combined ? truncate(combined, 300) : undefined;
  } catch {
    return undefined;
  }
}
