/** Shipping management. */
interface Shipment { id: string; orderId: string; address: string; status: string; tracking: string; }
const shipments: Shipment[] = [];
export function createShipment(orderId: string, address: string): string {
  const id=`ship_${shipments.length+1}`; shipments.push({id,orderId,address,status:"pending",tracking:""}); return id;
}
export function assignTracking(shipmentId: string, tracking: string): boolean {
  const s=shipments.find(s=>s.id===shipmentId); if(!s) return false; s.tracking=tracking; return true;
}
export function updateShipmentStatus(id: string, status: string): boolean {
  const s=shipments.find(s=>s.id===id); if(!s) return false; s.status=status; return true;
}
export function getShipmentsByOrder(orderId: string): Shipment[] { return shipments.filter(s=>s.orderId===orderId); }
export function getPendingShipments(): Shipment[] { return shipments.filter(s=>s.status==="pending"); }
export function calculateShippingCost(address: string, weight: number): number { return weight*5.0+(address.includes("international")?20:0); }
export function validateAddress(address: string): boolean { return address.length>10 && address.includes(","); }
export function estimateDelivery(address: string): number { return address.includes("express")?1:address.includes("international")?7:3; }
