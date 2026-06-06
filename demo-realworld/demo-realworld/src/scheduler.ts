interface Job { id:string; name:string; cron:string; lastRun:number; nextRun:number; status:string; }
const jobs:Job[]=[];
export function scheduleTask(name:string,cron:string):string{const id="job_"+(jobs.length+1);jobs.push({id,name,cron,lastRun:0,nextRun:Date.now()+3600000,status:"scheduled"});return id;}
export function executeNow(jobId:string):boolean{const j=jobs.find(j=>j.id===jobId);if(!j)return false;j.lastRun=Date.now();j.nextRun=Date.now()+3600000;j.status="completed";return true;}
export function cancelTask(jobId:string):boolean{const j=jobs.find(j=>j.id===jobId);if(!j)return false;j.status="cancelled";return true;}
export function getPendingTasks(){const now=Date.now();return jobs.filter(j=>j.status==="scheduled"&&j.nextRun<=now);}
export function getCompletedTasks(){return jobs.filter(j=>j.status==="completed");}
export function pauseTask(jobId:string):boolean{const j=jobs.find(j=>j.id===jobId);if(!j)return false;j.status="paused";return true;}
export function resumeTask(jobId:string):boolean{const j=jobs.find(j=>j.id===jobId);if(!j||j.status!=="paused")return false;j.status="scheduled";return true;}
export function rescheduleTask(jobId:string,newCron:string):boolean{const j=jobs.find(j=>j.id===jobId);if(!j)return false;j.cron=newCron;return true;}
export function getFailedTasks(){return jobs.filter(j=>j.status==="failed");}
export function retryAllFailed():number{const f=jobs.filter(j=>j.status==="failed");let n=0;for(const j of f){j.status="scheduled";j.nextRun=Date.now()+60000;n++;}return n;}
