interface Template { id:string; name:string; subject:string; body:string; vars:string[]; }
const templates:Template[]=[];
export function createTemplate(name:string,subject:string,body:string,vars:string[]):string{const id="tpl_"+(templates.length+1);templates.push({id,name,subject,body,vars});return id;}
export function compileTemplate(id:string,data:Record<string,string>):string{const t=templates.find(t=>t.id===id);if(!t)return"";let result=t.body;for(const [k,v] of Object.entries(data)){result=result.replace("{{"+k+"}}",v);}return result;}
export function listTemplates(){return templates;}
export function getTemplateVars(id:string):string[]{const t=templates.find(t=>t.id===id);return t?t.vars:[];}
export function updateTemplate(id:string,subject:string,body:string):boolean{const t=templates.find(t=>t.id===id);if(!t)return false;t.subject=subject;t.body=body;return true;}
export function deleteTemplate(id:string):boolean{const i=templates.findIndex(t=>t.id===id);if(i<0)return false;templates.splice(i,1);return true;}
export function cloneTemplate(id:string,newName:string):string{const t=templates.find(t=>t.id===id);if(!t)return"";return createTemplate(newName,t.subject,t.body,t.vars);}
export function previewTemplate(id:string,data:Record<string,string>):string{return compileTemplate(id,data);}
