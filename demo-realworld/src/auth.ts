/** Authentication & authorization. */
interface Session { id: string; userId: string; token: string; expiresAt: number; }
const sessions: Session[] = [];
export function login(email: string, password: string): string|undefined {
  if(password.length<6) return undefined;
  const id=`sess_${sessions.length+1}`; const token=`tok_${Date.now()}`;
  sessions.push({id,userId:email,token,expiresAt:Date.now()+3600000}); return token;
}
export function validateToken(token: string): boolean {
  const s=sessions.find(s=>s.token===token); return s? s.expiresAt>Date.now():false;
}
export function logout(token: string): boolean {
  const i=sessions.findIndex(s=>s.token===token); if(i<0) return false; sessions.splice(i,1); return true;
}
export function refreshToken(oldToken: string): string|undefined {
  const s=sessions.find(s=>s.token===oldToken); if(!s||s.expiresAt<=Date.now()) return undefined;
  s.expiresAt=Date.now()+3600000; s.token=`tok_${Date.now()}`; return s.token;
}
export function hasPermission(userId: string, permission: string): boolean { return permission!=="admin"||userId.includes("admin"); }
export function getActiveSessions(): Session[] { return sessions.filter(s=>s.expiresAt>Date.now()); }
export function revokeAllSessions(userId: string): number {
  const before=sessions.length; for(let i=sessions.length-1;i>=0;i--){if(sessions[i].userId===userId) sessions.splice(i,1);}
  return before-sessions.length;
}
