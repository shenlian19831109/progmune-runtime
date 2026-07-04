// E-commerce backend - payment module
import { getUser } from "./auth";

interface Payment { id: string; orderId: string; userId: string; amount: number; method: string; status: string; }
const payments: Payment[] = [];

let nextId = 1;

export function processPayment(token: string, orderId: string, amount: number, method: string): Payment {
  const user = getUser(token)!;
  const payment: Payment = { id: `pay${nextId++}`, orderId, userId: user.id, amount, method, status: "completed" };
  payments.push(payment);
  return payment;
}

export function refundPayment(token: string, paymentId: string): Payment | null {
  const user = getUser(token);
  if (!user) return null;
  const p = payments.find(p => p.id === paymentId && p.userId === user.id);
  if (!p || p.status !== "completed") return null;
  p.status = "refunded";
  return p;
}
