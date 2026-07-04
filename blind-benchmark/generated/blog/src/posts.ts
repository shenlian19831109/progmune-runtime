// Blog platform - posts module
import { getSessionUser } from "./auth";

interface Post { id: string; title: string; content: string; authorId: string; tags: string[]; createdAt: number; }
const posts: Post[] = [];

export function createPost(token: string, title: string, content: string, tags: string[]): Post | null {
  const user = getSessionUser(token);
  if (!user) return null;
  const post: Post = { id: `p${posts.length+1}`, title, content, authorId: user.id, tags, createdAt: Date.now() };
  posts.push(post);
  return post;
}

export function listPosts(): Post[] {
  return posts.sort((a, b) => b.createdAt - a.createdAt);
}

export function getPost(postId: string): Post | null {
  return posts.find(p => p.id === postId) || null;
}

export function updatePost(token: string, postId: string, title: string, content: string): Post | null {
  const user = getSessionUser(token);
  if (!user) return null;
  const post = posts.find(p => p.id === postId);
  if (!post || post.authorId !== user.id) return null;
  post.title = title;
  post.content = content;
  return post;
}

export function deletePost(token: string, postId: string): boolean {
  const user = getSessionUser(token);
  if (!user) return false;
  const idx = posts.findIndex(p => p.id === postId && p.authorId === user.id);
  if (idx < 0) return false;
  posts.splice(idx, 1);
  return true;
}

export function listPostsByTag(tag: string): Post[] {
  return posts.filter(p => p.tags.includes(tag));
}
