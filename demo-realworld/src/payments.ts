/** Payment processing. @requires ORDER_ID @produces PAYMENT */

interface Payment { id: string; orderId: string; amount: number; method: string; status: string; }
const payments: Payment[] = [];

/** Process a payment for an order. @requires ORDER_DATA @produces PAYMENT_ID */
export function processPayment(orderId: string, amount: number, method: string): string {
  const id = `pay_${payments.length + 1}`;
  payments.push({ id, orderId, amount, method, status: "completed" });
  return id;
}

/** Refund a payment. @requires PAYMENT_ID @produces REFUND_STATUS */
export function refundPayment(paymentId: string): boolean {
  const p = payments.find(p => p.id === paymentId);
  if (!p) return false;
  p.status = "refunded";
  return true;
}

/** Get total payments for an order. @requires ORDER_ID @produces PAYMENT_TOTAL */
export function getOrderPayments(orderId: string): Payment[] {
  return payments.filter(p => p.orderId === orderId);
}
