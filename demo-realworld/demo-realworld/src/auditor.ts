interface AuditRecord { id:string; actor:string; action:string; target:string; timestamp:number; metadata:any; }
const records:AuditRecord[]=[];
export function logAction(actor:string,action:string,target:string,metadata:any):string{const id="aud_"+(records.length+1);records.push({id,actor,action,target,timestamp:Date.now(),metadata});return id;}
export function queryByActor(actor:string){return records.filter(r=>r.actor===actor);}
export function queryByTarget(target:string){return records.filter(r=>r.target===target);}
export function queryByTimeRange(start:number,end:number){return records.filter(r=>r.timestamp>=start&&r.timestamp<=end);}
export function getRecentActivity(limit:number){return records.slice(-limit).reverse();}
export function exportAuditLog(format:string):string{return JSON.stringify(records);}
export function getActorSummary(actor:string){const actions=records.filter(r=>r.actor===actor);const byAction=new Map();for(const r of actions){byAction.set(r.action,(byAction.get(r.action)||0)+1);}return Object.fromEntries(byAction);}
export function purgeOldRecords(before:number):number{const before_len=records.length;for(let i=records.length-1;i>=0;i--){if(records[i].timestamp<before)records.splice(i,1);}return before_len-records.length;}
