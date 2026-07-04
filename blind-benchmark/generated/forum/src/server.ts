// Discussion forum - server entry point
import { createAccount, logIn, logOut } from "./auth";
import { addCategory, listCategories, getCategory } from "./categories";
import { createTopic, listTopics, getTopic, lockTopic } from "./topics";
import { createReply, listReplies, deleteReply } from "./replies";
import { deleteTopicMod, deleteReplyMod, banUser, getModLogs } from "./moderation";

export function handleRequest(method: string, path: string, body: any, token?: string): any {
  if (path === "/register" && method === "POST") return { data: createAccount(body.username, body.email, body.password) };
  if (path === "/login" && method === "POST") {
    const s = logIn(body.email, body.password);
    return s ? { data: { token: s.token } } : { error: "Invalid credentials", status: 401 };
  }
  if (path === "/logout" && method === "POST") { logOut(token!); return { data: true }; }

  if (path === "/categories" && method === "POST") return { data: addCategory(body.name, body.description) };
  if (path === "/categories" && method === "GET") return { data: listCategories() };
  if (path.startsWith("/categories/") && method === "GET") return { data: getCategory(path.split("/")[2]) };

  if (path === "/topics" && method === "POST") return { data: createTopic(token!, body.categoryId, body.title, body.content) };
  if (path === "/topics" && method === "GET") return { data: listTopics(body.categoryId) };
  if (path.startsWith("/topics/") && method === "GET") return { data: getTopic(path.split("/")[2]) };
  if (path.startsWith("/topics/") && path.endsWith("/lock") && method === "POST") return { data: lockTopic(path.split("/")[2]) };

  if (path === "/replies" && method === "POST") return { data: createReply(token!, body.topicId, body.content) };
  if (path === "/replies" && method === "GET") return { data: listReplies(body.topicId) };
  if (path.startsWith("/replies/") && method === "DELETE") return { data: deleteReply(token!, path.split("/")[2]) };

  if (path.startsWith("/mod/delete-topic/") && method === "POST") return { data: deleteTopicMod(token!, path.split("/")[2]) };
  if (path.startsWith("/mod/delete-reply/") && method === "POST") return { data: deleteReplyMod(token!, path.split("/")[2]) };
  if (path === "/mod/ban" && method === "POST") return { data: banUser(token!, body.userId) };
  if (path === "/mod/logs" && method === "GET") return { data: getModLogs() };

  return { error: "Not found", status: 404 };
}
