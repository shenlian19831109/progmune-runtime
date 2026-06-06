interface Limit { key:string; max:number; window:number; current:number; resetAt:number; }
const limits:Limit[]=[];
export function defineLimit(key:string,max:number,window:number):string{limits.push({key,max,window,current:0,resetAt:Date.now()+window*1000});return key;}
export function checkQuota(key:string):boolean{const l=limits.find(l=>l.key===key);if(!l)return true;if(Date.now()>l.resetAt){l.current=0;l.resetAt=Date.now()+l.window*1000;}if(l.current>=l.max)return false;l.current++;return true;}
export function getRemainingQuota(key:string):number{const l=limits.find(l=>l.key===key);return l?l.max-l.current:0;}
export function resetQuota(key:string):boolean{const l=limits.find(l=>l.key===key);if(!l)return false;l.current=0;return true;}
export function getQuotaStatus(key:string){const l=limits.find(l=>l.key===key);if(!l)return{max:0,used:0,remaining:0};return{max:l.max,used:l.current,remaining:l.max-l.current};}
export function listAllQuotas(){return limits;}
export function updateQuotaWindow(key:string,w:number):boolean{const l=limits.find(l=>l.key===key);if(!l)return false;l.window=w;return true;}
export function isThrottled(key:string):boolean{return !checkQuota(key);}
export function getThrottledKeys():string[]{return limits.filter(l=>l.current>=l.max).map(l=>l.key);}
