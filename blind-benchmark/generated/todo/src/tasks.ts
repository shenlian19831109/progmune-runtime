// Todo list API - tasks module
import { verifySession } from "./auth";

interface Task { id: string; title: string; done: boolean; ownerId: string; projectId?: string; createdAt: number; }
const tasks: Task[] = [];

let nextId = 1;

export function addTask(token: string, title: string, projectId?: string): Task | null {
  const user = verifySession(token);
  if (!user) return null;
  const task: Task = { id: `t${nextId++}`, title, done: false, ownerId: user.id, projectId, createdAt: Date.now() };
  tasks.push(task);
  return task;
}

export function listTasks(token: string): Task[] | null {
  const user = verifySession(token);
  if (!user) return null;
  return tasks.filter(t => t.ownerId === user.id);
}

export function toggleTask(token: string, taskId: string): Task | null {
  const user = verifySession(token);
  if (!user) return null;
  const task = tasks.find(t => t.id === taskId);
  if (!task) return null;
  task.done = !task.done;
  return task;
}

export function removeTask(token: string, taskId: string): boolean {
  const user = verifySession(token);
  if (!user) return false;
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return false;
  tasks.splice(idx, 1);
  return true;
}
