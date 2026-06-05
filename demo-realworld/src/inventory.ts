/** Inventory management. */
interface Product { id: string; name: string; stock: number; price: number; }
const products: Product[] = [];
export function addProduct(name: string, stock: number, price: number): string {
  const id = `prod_${products.length+1}`; products.push({id,name,stock,price}); return id;
}
export function getProduct(id: string): Product|undefined { return products.find(p=>p.id===id); }
export function updateStock(id: string, delta: number): boolean {
  const p=products.find(p=>p.id===id); if(!p) return false; p.stock+=delta; return true;
}
export function listLowStock(threshold: number): Product[] { return products.filter(p=>p.stock<threshold); }
export function getInventoryValue(): number { return products.reduce((s,p)=>s+p.stock*p.price,0); }
export function searchProducts(query: string): Product[] {
  const q=query.toLowerCase(); return products.filter(p=>p.name.toLowerCase().includes(q));
}
export function removeProduct(id: string): boolean {
  const i=products.findIndex(p=>p.id===id); if(i<0) return false; products.splice(i,1); return true;
}
export function getStockSummary(): {total:number; low:number; outOfStock:number} {
  const low=products.filter(p=>p.stock>0&&p.stock<10).length;
  const out=products.filter(p=>p.stock===0).length;
  return {total:products.length, low, outOfStock:out};
}
