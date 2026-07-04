// E-commerce backend - orders module
import { getUser } from "./auth";
import { updateStock } from "./products";

interface Order { id: string; userId: string; items: { productId: string; quantity: number; }[]; total: number; status: string; }
const orders: Order[] = [];

let nextId = 1;

export function placeOrder(token: string, items: { productId: string; quantity: number; }[]): Order | null {
  const user = getUser(token);
  if (!user) return null;
  for (const item of items) {
    const ok = updateStock(item.productId, item.quantity);
    if (!ok) return null;
  }
  const order: Order = { id: `ord${nextId++}`, userId: user.id, items, total: items.reduce((s, i) => s + i.quantity * 10, 0), status: "confirmed" };
  orders.push(order);
  return order;
}

export function getOrder(token: string, orderId: string): Order | null {
  const user = getUser(token);
  if (!user) return null;
  return orders.find(o => o.id === orderId && o.userId === user.id) || null;
}
