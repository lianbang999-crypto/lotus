import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...inputs:ClassValue[])=>twMerge(clsx(inputs));
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const money=(cents:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(cents/100);
export async function api<T>(path:string, body?:unknown):Promise<T>{
 const response=await fetch(path,{credentials:'include',...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await response.json().catch(()=>({message:'服务暂时无法连接，请稍后再试。'}));
 if(!response.ok){
  const error=data&&typeof data==='object'?data as Record<string,unknown>:{};
  throw new Error(typeof error.message==='string'?error.message:typeof error.error==='string'?error.error:'操作未完成，请重试');
 }
 return data as T;
}
