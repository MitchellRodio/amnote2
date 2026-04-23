import { PrismaClient, Task, TaskStatus } from '@prisma/client';
import { createHubspotTask, completeHubspotTask } from './hubspot';

const prisma = new PrismaClient();

export type CreateTaskInput = {
  title: string;
  notes?: string;
  dueDate?: Date | null;
  creatorChannelId: string;
  createdBy: string;
};

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const { title, notes, dueDate, creatorChannelId, createdBy } = input;

  // 👉 you can replace this with real company lookup logic if you have it
  const companyId = null;

  let hubspotId: number | null = null;

  try {
    hubspotId = await createHubspotTask({
      title,
      notes,
      dueDate,
      companyId,
    });
  } catch (err) {
    console.error('HubSpot create failed:', err);
  }

  return prisma.task.create({
    data: {
      title,
      notes,
      dueDate,
      creatorChannelId,
      createdBy,
      status: 'OPEN',
      hubspotId: hubspotId ?? undefined,
    },
  });
}

export async function updateTaskStatus(
  taskId: number,
  status: TaskStatus
): Promise<Task> {
  const task = await prisma.task.update({
    where: { id: taskId },
    data: { status },
  });

  if (status === 'DONE' && task.hubspotId) {
    try {
      await completeHubspotTask(task.hubspotId);
    } catch (err) {
      console.error('HubSpot complete failed:', err);
    }
  }

  return task;
}

export async function getTasksByUser(userId: string): Promise<Task[]> {
  return prisma.task.findMany({
    where: { createdBy: userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getTasksByChannel(
  channelId: string
): Promise<Task[]> {
  return prisma.task.findMany({
    where: { creatorChannelId: channelId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getOverdueTasks(): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      dueDate: {
        lt: new Date(),
      },
      status: {
        not: 'DONE',
      },
    },
  });
}