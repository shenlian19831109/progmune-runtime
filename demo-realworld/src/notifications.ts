/** Notification service. @requires USER_ID @produces NOTIFICATION */

interface Notification { id: string; userId: string; message: string; sent: boolean; }
const notifications: Notification[] = [];

/** Send a notification to a user. @requires USER_ID_MESSAGE @produces NOTIFICATION_ID */
export function sendNotification(userId: string, message: string): string {
  const id = `notif_${notifications.length + 1}`;
  notifications.push({ id, userId, message, sent: true });
  return id;
}

/** Get unread notifications for a user. @requires USER_ID @produces NOTIFICATION_LIST */
export function getUnreadNotifications(userId: string): Notification[] {
  return notifications.filter(n => n.userId === userId && !n.sent);
}

/** Mark a notification as read. @requires NOTIFICATION_ID @produces READ_STATUS */
export function markAsRead(notificationId: string): boolean {
  const n = notifications.find(n => n.id === notificationId);
  if (!n) return false;
  n.sent = true;
  return true;
}
