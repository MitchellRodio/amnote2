import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_APP_TOKEN: z.string().min(1),
  SLACK_SIGNING_SECRET: z.string().optional().default('unused-in-socket-mode'),
  TODO_REACTION: z.string().optional().default('spiral_note_pad'),
  DEFAULT_REMINDER_HOUR: z.coerce.number().optional().default(9),
  TIMEZONE: z.string().optional().default('America/New_York'),
  SLACK_LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).optional().default('info'),
  HUBSPOT_ACCESS_TOKEN: z.string().min(1),
  HUBSPOT_BASE_URL: z.string().optional().default('https://api.hubapi.com'),
  HUBSPOT_SLACK_CHANNEL_OBJECT_TYPE: z.string().min(1),
  HUBSPOT_TASK_TO_COMPANY_ASSOCIATION_TYPE_ID: z.coerce.number().optional().default(192),
  HUBSPOT_SLACK_CHANNEL_TO_COMPANY_ASSOCIATION_TYPE_ID: z.coerce.number().optional(),
  HUBSPOT_OWNER_ID: z.string().optional(),
  HUBSPOT_OWNER_EMAIL: z.string().optional()
});

export const env = envSchema.parse(process.env);
