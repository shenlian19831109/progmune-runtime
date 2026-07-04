// Todo list API - projects module
import { verifySession } from "./auth";

interface Project { id: string; name: string; ownerId: string; }
const projects: Project[] = [];

let nextId = 1;

export function createProject(token: string, name: string): Project | null {
  const user = verifySession(token);
  if (!user) return null;
  const project: Project = { id: `pr${nextId++}`, name, ownerId: user.id };
  projects.push(project);
  return project;
}

export function listProjects(token: string): Project[] | null {
  const user = verifySession(token);
  if (!user) return null;
  return projects.filter(p => p.ownerId === user.id);
}

export function deleteProject(token: string, projectId: string): boolean {
  const user = verifySession(token);
  if (!user) return false;
  const idx = projects.findIndex(p => p.id === projectId && p.ownerId === user.id);
  if (idx < 0) return false;
  projects.splice(idx, 1);
  return true;
}
