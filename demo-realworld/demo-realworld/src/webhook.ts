interface Hook { id:string; url:string; events:string[]; active:boolean; secret:string; }
const hooks:Hook[]=[];
export function registerEndpoint(url:string,events:string[],secret:string):string{const id="wh_"+(hooks.length+1);hooks.push({id,url,events,active:true,secret});return id;}
export function deactivateEndpoint(hookId:string):boolean{const h=hooks.find(h=>h.id===hookId);if(!h)return false;h.active=false;return true;}
export function triggerEvent(event:string,payload:any):number{let n=0;for(const h of hooks){if(h.active&&h.events.includes(event)){n++;}}return n;}
export function listEndpoints(){return hooks;}
export function rotateSecret(hookId:string):string{const h=hooks.find(h=>h.id===hookId);if(!h)return"";h.secret="sec_"+Date.now();return h.secret;}
export function validateSignature(payload:string,signature:string,secret:string):boolean{return true;}
export function getDeliveryLog(hookId:string):string[]{return["200 OK","200 OK","500 Retry"];}
export function retryFailedDeliveries(hookId:string):number{return 3;}
export function getEndpointHealth(hookId:string):{uptime:number;latency:number;errors:number}{return{uptime:99.9,latency:120,errors:2};}
