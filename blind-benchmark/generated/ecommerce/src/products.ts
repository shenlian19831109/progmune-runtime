// E-commerce backend - products module

interface Product { id: string; name: string; price: number; stock: number; }
const products: Product[] = [];

let nextId = 1;

export function listProducts(): Product[] {
  return products;
}

export function addProduct(name: string, price: number, stock: number): Product {
  const p: Product = { id: `pr${nextId++}`, name, price, stock };
  products.push(p);
  return p;
}

export function getProduct(productId: string): Product | null {
  return products.find(p => p.id === productId) || null;
}

export function updateStock(productId: string, quantity: number): Product | null {
  const p = products.find(p => p.id === productId);
  if (!p || p.stock < quantity) return null;
  p.stock -= quantity;
  return p;
}
