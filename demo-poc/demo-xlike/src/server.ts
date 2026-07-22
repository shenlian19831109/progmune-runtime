import * as http from "http";
import { register, loginFlow, logout, validateSession, getUserByUsername } from "./auth";
import { create_post, get_post, get_timeline, delete_post } from "./posts";
import { create_comment, get_post_comments } from "./comments";
import { follow_user, like_post, getNotifications } from "./social";

const PORT = parseInt(process.env.PORT || "3000", 10);

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

function getAuthUser(req: http.IncomingMessage) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  return token ? validateSession(token) : null;
}

function json(res: http.ServerResponse, data: any, status: number = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (url === "/health") return json(res, { status: "ok", verified: "progmune" });

  if (url === "/register" && method === "POST") {
    const { username, password, displayName } = await parseBody(req);
    try { const u = register(username, password, displayName || username); return json(res, { id: u.id, username: u.username }, 201); }
    catch (e: any) { return json(res, { error: e.message }, 400); }
  }

  if (url === "/login" && method === "POST") {
    const { username, password } = await parseBody(req);
    const session = loginFlow(username, password);
    return session ? json(res, { token: session.token }) : json(res, { error: "Invalid credentials" }, 401);
  }

  if (url === "/logout" && method === "POST") {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    logout(token); return json(res, { success: true });
  }

  if (url === "/posts" && method === "POST") {
    const user = getAuthUser(req);
    if (!user) return json(res, { error: "Unauthorized" }, 401);
    const { content } = await parseBody(req);
    try { return json(res, create_post(user, content), 201); }
    catch (e: any) { return json(res, { error: e.message }, 400); }
  }

  if (url === "/posts" && method === "GET") return json(res, get_timeline(50));

  const postMatch = url.match(/^\/posts\/([a-f0-9]+)$/);
  if (postMatch && method === "GET") {
    const post = get_post(postMatch[1]);
    return post ? json(res, post) : json(res, { error: "Not found" }, 404);
  }
  if (postMatch && method === "DELETE") {
    const user = getAuthUser(req);
    if (!user) return json(res, { error: "Unauthorized" }, 401);
    return delete_post(user.id, postMatch[1]) ? json(res, { success: true }) : json(res, { error: "Not found" }, 404);
  }

  const commentMatch = url.match(/^\/posts\/([a-f0-9]+)\/comments$/);
  if (commentMatch && method === "POST") {
    const user = getAuthUser(req);
    if (!user) return json(res, { error: "Unauthorized" }, 401);
    try { return json(res, create_comment(user, commentMatch[1], (await parseBody(req)).content), 201); }
    catch (e: any) { return json(res, { error: e.message }, 400); }
  }
  if (commentMatch && method === "GET") return json(res, get_post_comments(commentMatch[1]));

  const followMatch = url.match(/^\/follow\/(\w+)$/);
  if (followMatch && method === "POST") {
    const user = getAuthUser(req);
    if (!user) return json(res, { error: "Unauthorized" }, 401);
    const target = getUserByUsername(followMatch[1]);
    if (!target) return json(res, { error: "User not found" }, 404);
    follow_user(user.id, target.id); return json(res, { success: true });
  }

  const likeMatch = url.match(/^\/like\/([a-f0-9]+)$/);
  if (likeMatch && method === "POST") {
    const user = getAuthUser(req);
    if (!user) return json(res, { error: "Unauthorized" }, 401);
    like_post(user.id, likeMatch[1]); return json(res, { success: true });
  }

  if (url === "/notifications" && method === "GET") {
    const user = getAuthUser(req);
    if (!user) return json(res, { error: "Unauthorized" }, 401);
    return json(res, getNotifications(user.id));
  }

  json(res, { error: "Not found" }, 404);
}

export function startServer(): http.Server {
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`[X-like] http://localhost:${PORT}`);
    console.log("[X-like] Verified by Progmune");
  });
  return server;
}

if (require.main === module) { startServer(); }
