import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_APP_TOKEN: z.string().min(1),
  SLACK_SIGNING_SECRET: z.string().optional().default('unused-in-socket-mode'),
  DATABASE_URL: z.string().min(1),
  TODO_REACTION: z.string().optional().default('spiral_note_pad'),
  DEFAULT_REMINDER_HOUR: z.coerce.number().optional().default(9),
  TIMEZONE: z.string().optional().default('America/New_York'),
  SLACK_LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).optional().default('info'),
  HUBSPOT_ACCESS_TOKEN: z.string().optional(),
  HUBSPOT_BASE_URL: z.string().optional().default('https://api.hubapi.com'),
  HUBSPOT_CHANNEL_PREFIXES: z.string().optional().default('whop-x-,whop-'),
  HUBSPOT_COMPANY_OVERRIDES: z.string().optional().default('{}')
});

export const env = envSchema.parse(process.env);
