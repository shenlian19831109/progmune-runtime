/**
 * User management — real-world service functions.
 */

interface User { id: string; name: string; email: string; role: string; }

const users: User[] = [];

/** Find a user by email. @requires EMAIL @produces USER */
export function findUserByEmail(email: string): User | undefined {
  return users.find(u => u.email === email);
}

/** Create a new user. @requires USER_DATA @produces USER_ID */
export function createUser(name: string, email: string, role: string): string {
  const id = `user_${users.length + 1}`;
  users.push({ id, name, email, role });
  return id;
}

/** Validate user role has required permissions. @requires USER_ROLE @produces PERMISSION_RESULT */
export function validateUserRole(userId: string, requiredRole: string): boolean {
  const u = users.find(u => u.id === userId);
  return u ? u.role === requiredRole : false;
}

/** Get all users with a given role. @requires ROLE @produces USER_LIST */
export function listUsersByRole(role: string): User[] {
  return users.filter(u => u.role === role);
}
