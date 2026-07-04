// Blog platform - server entry point
import { register, login, logout } from "./auth";
import { createPost, listPosts, getPost, updatePost, deletePost, listPostsByTag } from "./posts";
import { addComment, getCommentsForPost, deleteComment } from "./comments";

export function handleRequest(method: string, path: string, body: any, token?: string): any {
  // Auth
  if (path === "/register" && method === "POST") return { data: register(body.email, body.password, body.name) };
  if (path === "/login" && method === "POST") {
    const s = login(body.email, body.password);
    return s ? { data: { token: s.token } } : { error: "Invalid credentials", status: 401 };
  }
  if (path === "/logout" && method === "POST") return { data: logout(token || "") };

  // Posts
  if (path === "/posts" && method === "POST") return { data: createPost(token!, body.title, body.content, body.tags || []) };
  if (path === "/posts" && method === "GET") return { data: body.tag ? listPostsByTag(body.tag) : listPosts() };
  if (path.startsWith("/posts/") && method === "GET") return { data: getPost(path.split("/")[2]) };
  if (path.startsWith("/posts/") && method === "PUT") return { data: updatePost(token!, path.split("/")[2], body.title, body.content) };
  if (path.startsWith("/posts/") && method === "DELETE") return { data: deletePost(token!, path.split("/")[2]) };

  // Comments
  if (path === "/comments" && method === "POST") return { data: addComment(token!, body.postId, body.content) };
  if (path === "/comments" && method === "GET") return { data: getCommentsForPost(body.postId) };
  if (path.startsWith("/comments/") && method === "DELETE") return { data: deleteComment(token!, path.split("/")[2]) };

  return { error: "Not found", status: 404 };
}
