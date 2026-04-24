import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { env } from './env';
import { TaskPriority, TaskStatus } from '../types/domain';

dayjs.extend(utc);
dayjs.extend(timezone);

export function humanizeStatus(status: TaskStatus): string {
  return status === 'DONE' ? 'Done' : 'Open';
}

export function humanizePriority(priority: TaskPriority): string {
  return priority.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatDueDate(date?: Date | null): string {
  if (!date) return 'None';
  return dayjs(date).tz(env.TIMEZONE).format('MMM D, YYYY h:mm A z');
}

export function truncate(text: string, max = 120): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function sanitizeTaskTitle(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}
