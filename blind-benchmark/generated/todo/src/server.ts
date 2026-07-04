// Todo list API - server entry point
import { registerUser, authenticateUser, endSession } from "./auth";
import { addTask, listTasks, toggleTask, removeTask } from "./tasks";
import { createProject, listProjects, deleteProject } from "./projects";

export function handleRequest(method: string, path: string, body: any, token?: string): any {
  // Auth
  if (path === "/register" && method === "POST") return { data: registerUser(body.username, body.password) };
  if (path === "/login" && method === "POST") {
    const s = authenticateUser(body.username, body.password);
    return s ? { data: { token: s.token } } : { error: "Invalid login", status: 401 };
  }
  if (path === "/logout" && method === "POST") return { data: endSession(token || "") };

  // Tasks
  if (path === "/tasks" && method === "POST") return { data: addTask(token!, body.title, body.projectId) };
  if (path === "/tasks" && method === "GET") return { data: listTasks(token!) };
  if (path.startsWith("/tasks/") && path.endsWith("/toggle") && method === "PUT") {
    return { data: toggleTask(token!, path.split("/")[2]) };
  }
  if (path.startsWith("/tasks/") && method === "DELETE") return { data: removeTask(token!, path.split("/")[2]) };

  // Projects
  if (path === "/projects" && method === "POST") return { data: createProject(token!, body.name) };
  if (path === "/projects" && method === "GET") return { data: listProjects(token!) };
  if (path.startsWith("/projects/") && method === "DELETE") return { data: deleteProject(token!, path.split("/")[2]) };

  return { error: "Not found", status: 404 };
}
