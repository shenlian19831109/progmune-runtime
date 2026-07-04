// E-commerce backend - server entry point
import { signUp, signIn, signOut } from "./auth";
import { listProducts, addProduct } from "./products";
import { addToCart, viewCart } from "./cart";
import { placeOrder, getOrder } from "./orders";
import { processPayment, refundPayment } from "./payment";

export function handleRequest(method: string, path: string, body: any, token?: string): any {
  if (path === "/register" && method === "POST") return { data: signUp(body.email, body.password) };
  if (path === "/login" && method === "POST") {
    const s = signIn(body.email, body.password);
    return s ? { data: { token: s.token } } : { error: "Login failed", status: 401 };
  }
  if (path === "/logout" && method === "POST") { signOut(token!); return { data: true }; }

  if (path === "/products" && method === "GET") return { data: listProducts() };
  if (path === "/products" && method === "POST") return { data: addProduct(body.name, body.price, body.stock) };

  if (path === "/cart" && method === "POST") return { data: addToCart(token!, body.productId, body.quantity) };
  if (path === "/cart" && method === "GET") return { data: viewCart(token!) };

  if (path === "/orders" && method === "POST") return { data: placeOrder(token!, body.items) };
  if (path.startsWith("/orders/") && method === "GET") return { data: getOrder(token!, path.split("/")[2]) };

  if (path === "/payment" && method === "POST") return { data: processPayment(token!, body.orderId, body.amount, body.method) };
  if (path.startsWith("/payment/") && path.endsWith("/refund") && method === "POST") return { data: refundPayment(token!, path.split("/")[2]) };

  return { error: "Not found", status: 404 };
}
