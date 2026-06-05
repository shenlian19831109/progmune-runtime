/** Order management. @requires USER_ID @produces ORDER */

interface Order { id: string; userId: string; items: string[]; total: number; status: string; }
const orders: Order[] = [];

/** Create a new order. @requires CART_DATA @produces ORDER_ID */
export function createOrder(userId: string, items: string[], total: number): string {
  const id = `ord_${orders.length + 1}`;
  orders.push({ id, userId, items, total, status: "pending" });
  return id;
}

/** Get all orders for a user. @requires USER_ID @produces ORDER_LIST */
export function getOrdersByUser(userId: string): Order[] {
  return orders.filter(o => o.userId === userId);
}

/** Update order status. @requires ORDER_ID_STATUS @produces UPDATED_ORDER */
export function updateOrderStatus(orderId: string, status: string): Order | undefined {
  const o = orders.find(o => o.id === orderId);
  if (o) o.status = status;
  return o;
}

/** Calculate total revenue from completed orders. @requires ORDER_LIST @produces REVENUE */
export function calculateRevenue(): number {
  return orders.filter(o => o.status === "completed").reduce((s, o) => s + o.total, 0);
}
