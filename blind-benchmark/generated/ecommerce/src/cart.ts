// E-commerce backend - cart module
import { getUser } from "./auth";
import { getProduct, updateStock } from "./products";

interface CartItem { productId: string; quantity: number; }
const carts: Map<string, CartItem[]> = new Map();

export function addToCart(token: string, productId: string, quantity: number): CartItem[] | null {
  const user = getUser(token);
  if (!user) return null;
  const product = getProduct(productId);
  if (!product) return null;
  const cart = carts.get(user.id) || [];
  const existing = cart.find(i => i.productId === productId);
  if (existing) { existing.quantity += quantity; }
  else { cart.push({ productId, quantity }); }
  carts.set(user.id, cart);
  return cart;
}

export function viewCart(token: string): CartItem[] | null {
  const user = getUser(token);
  if (!user) return null;
  return carts.get(user.id) || [];
}
