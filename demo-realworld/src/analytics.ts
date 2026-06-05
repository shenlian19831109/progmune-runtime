/** Business analytics. */
interface Event { type: string; userId: string; timestamp: number; data: any; }
const events: Event[] = [];
export function trackEvent(type: string, userId: string, data: any): void { events.push({type,userId,timestamp:Date.now(),data}); }
export function getEventsByType(type: string): Event[] { return events.filter(e=>e.type===type); }
export function getEventsByUser(userId: string): Event[] { return events.filter(e=>e.userId===userId); }
export function getEventCount(type: string, since: number): number {
  return events.filter(e=>e.type===type&&e.timestamp>=since).length;
}
export function getDailyActiveUsers(): number { const today=Date.now()-86400000; return new Set(events.filter(e=>e.timestamp>=today).map(e=>e.userId)).size; }
export function getConversionRate(funnel: string[]): number {
  let users=new Set<string>(); for(const e of events) if(e.type===funnel[0]) users.add(e.userId);
  if(users.size===0) return 0;
  let converted=0; for(const uid of users){ let ok=true; for(let i=1;i<funnel.length;i++){if(!events.some(e=>e.userId===uid&&e.type===funnel[i])){ok=false;break;}}if(ok)converted++;}
  return converted/users.size;
}
export function getTopEvents(limit: number): {type:string;count:number}[] {
  const map=new Map<string,number>(); for(const e of events) map.set(e.type,(map.get(e.type)||0)+1);
  return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([type,count])=>({type,count}));
}
