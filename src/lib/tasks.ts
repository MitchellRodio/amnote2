import { Task, TaskPriority, TaskStatus } from '@prisma/client';
import { prisma } from './db';
import { createHubSpotTask, updateHubSpotTask } from './hubspot';

export type CreateTaskInput = {
  title: string;
  creatorChannelId: string;
  creatorChannelName?: string;
  createdByUserId: string;
  createdByName?: string;
  assignedToUserId?: string;
  assignedToName?: string;
  sourceMessageTs?: string;
  sourceMessageLink?: string;
  threadTs?: string;
  contextSnippet?: string;
  notes?: string;
  dueDate?: Date | null;
};

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const task = await prisma.task.create({
    data: {
      title: input.title,
      creatorChannelId: input.creatorChannelId,
      creatorChannelName: input.creatorChannelName,
      createdByUserId: input.createdByUserId,
      createdByName: input.createdByName,
      assignedToUserId: input.assignedToUserId ?? input.createdByUserId,
      assignedToName: input.assignedToName ?? input.createdByName,
      sourceMessageTs: input.sourceMessageTs,
      sourceMessageLink: input.sourceMessageLink,
      threadTs: input.threadTs,
      contextSnippet: input.contextSnippet,
      notes: input.notes,
      dueDate: input.dueDate ?? null
    }
  });

  try {
    const hubspot = await createHubSpotTask(task);
    if (hubspot?.hubspotTaskId) {
      return prisma.task.update({
        where: { id: task.id },
        data: {
          hubspotTaskId: hubspot.hubspotTaskId,
          hubspotCompanyId: hubspot.hubspotCompanyId,
          hubspotCompanyName: hubspot.hubspotCompanyName
        }
      });
    }
  } catch (error) {
    console.error('HubSpot task create failed', error);
  }

  return task;
}

export async function listTasksForUser(userId: string): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      assignedToUserId: userId,
      status: {
        not: TaskStatus.DONE
      }
    },
    orderBy: [
      { priority: 'desc' },
      { createdAt: 'desc' }
    ]
  });
}

export async function listTasksForChannel(channelId: string): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      creatorChannelId: channelId,
      status: {
        not: TaskStatus.DONE
      }
    },
    orderBy: [
      { priority: 'desc' },
      { createdAt: 'desc' }
    ]
  });
}

export async function listOverdueTasks(userId?: string): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      status: {
        not: TaskStatus.DONE
      },
      dueDate: {
        lt: new Date()
      },
      ...(userId ? { assignedToUserId: userId } : {})
    },
    orderBy: [
      { dueDate: 'asc' }
    ]
  });
}

export async function getTaskById(taskId: number): Promise<Task | null> {
  return prisma.task.findUnique({ where: { id: taskId } });
}

export async function updateTaskStatus(taskId: number, status: TaskStatus): Promise<Task> {
  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      status,
      completedAt: status === TaskStatus.DONE ? new Date() : null
    }
  });

  try {
    await updateHubSpotTask(task);
  } catch (error) {
    console.error('HubSpot task status sync failed', error);
  }

  return task;
}

export async function updateTaskPriority(taskId: number, priority: TaskPriority): Promise<Task> {
  const task = await prisma.task.update({
    where: { id: taskId },
    data: { priority }
  });

  try {
    await updateHubSpotTask(task);
  } catch (error) {
    console.error('HubSpot task priority sync failed', error);
  }

  return task;
}

export async function updateTaskDueDate(taskId: number, dueDate: Date | null): Promise<Task> {
  const task = await prisma.task.update({
    where: { id: taskId },
    data: { dueDate }
  });

  try {
    await updateHubSpotTask(task);
  } catch (error) {
    console.error('HubSpot task due date sync failed', error);
  }

  return task;
}

export async function taskCountsForToday(userId: string): Promise<{ total: number; overdue: number; high: number }> {
  const [total, overdue, high] = await Promise.all([
    prisma.task.count({ where: { assignedToUserId: userId, status: { not: TaskStatus.DONE } } }),
    prisma.task.count({ where: { assignedToUserId: userId, status: { not: TaskStatus.DONE }, dueDate: { lt: new Date() } } }),
    prisma.task.count({ where: { assignedToUserId: userId, status: { not: TaskStatus.DONE }, priority: TaskPriority.HIGH } })
  ]);

  return { total, overdue, high };
}
