interface Sub { id:string; userId:string; plan:string; status:string; startedAt:number; }
const subs:Sub[]=[];
export function activatePlan(userId:string,plan:string):string{const id="sub_"+(subs.length+1);subs.push({id,userId,plan,status:"active",startedAt:Date.now()});return id;}
export function deactivatePlan(subId:string):boolean{const s=subs.find(s=>s.id===subId);if(!s)return false;s.status="inactive";return true;}
export function upgradeTier(subId:string,newPlan:string):boolean{const s=subs.find(s=>s.id===subId);if(!s)return false;s.plan=newPlan;return true;}
export function getActiveSubs(){return subs.filter(s=>s.status==="active");}
export function getExpiringSubs(days:number){const cutoff=Date.now()+days*86400000;return subs.filter(s=>s.status==="active"&&s.startedAt+30*86400000<cutoff);}
export function computeMRR():number{return subs.filter(s=>s.status==="active").length*29.99;}
export function getChurnRate():number{const cancelled=subs.filter(s=>s.status==="inactive").length;return subs.length>0?cancelled/subs.length:0;}
export function sendRenewalNotice(subId:string):boolean{return true;}
export function applyDiscount(subId:string,pct:number):boolean{return true;}
export function getPlanUsage(subId:string):{api:number;storage:number;users:number}{return{api:1000,storage:50,users:5};}
