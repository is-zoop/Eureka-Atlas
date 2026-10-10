"use client";
import { useEffect, useState } from "react";
import type { DataQueryFilter, QueryExecution } from "@eureka-atlas/types";
import { ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function CandidateValues({tableId,fieldId,filters,values,onChange}:{tableId:string;fieldId:string;filters:DataQueryFilter[];values:string[];onChange:(values:string[])=>void}) {
  const [open,setOpen] = useState(false),[keyword,setKeyword] = useState(""),[state,setState] = useState<{values:string[];message:string}>({values:[],message:""});
  const context = JSON.stringify(filters.filter(item => item.field_id !== fieldId));
  useEffect(() => {
    if(!open)return;
    const controller = new AbortController();
    let wait: ReturnType<typeof setTimeout>;
    const pollDelay = () => new Promise<void>(resolve => {const finish=()=>{clearTimeout(wait);controller.signal.removeEventListener("abort",finish);resolve();};wait=setTimeout(finish,1000);controller.signal.addEventListener("abort",finish,{once:true});});
    const timer = setTimeout(async () => {
      setState({values:[],message:"正在获取候选值…"});
      try {
        let result = await api<QueryExecution>("/data-queries/dimension-values",{method:"POST",body:JSON.stringify({table_id:tableId,field_id:fieldId,keyword,filters:JSON.parse(context),idempotency_key:crypto.randomUUID()}),signal:controller.signal});
        while(!["SUCCEEDED","FAILED","CANCELLED","TIMED_OUT"].includes(result.status)) {await pollDelay();controller.signal.throwIfAborted();result=await api<QueryExecution>("/queries/"+result.id,{signal:controller.signal});}
        controller.signal.throwIfAborted();
        if(result.status !== "SUCCEEDED")throw new Error(result.error ?? "候选值查询失败");
        const candidates = result.result?.rows.map(row => row[0]).filter(value => value !== null).map(String) ?? [];
        setState({values:candidates,message:result.result?.truncated ? "候选值超过 200 个，请搜索缩小范围" : candidates.length ? "" : "没有候选值，可关闭后手动输入"});
      }catch(error) {if(!controller.signal.aborted)setState({values:[],message:error instanceof Error ? error.message : "候选值服务不可用"});}
    },300);
    return () => {controller.abort();clearTimeout(timer);clearTimeout(wait);};
  },[open,keyword,context,tableId,fieldId]);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="outline" size="sm" className="h-9">候选值<ChevronDown className="size-3 text-slate-400"/></Button></PopoverTrigger>
    <PopoverContent align="end" sideOffset={8} className="w-72 max-w-[calc(100vw-2rem)] rounded-xl border-slate-200 bg-white p-3 text-slate-700 shadow-lg"><Input className="h-9 border-slate-200 shadow-none" value={keyword} onChange={event=>setKeyword(event.target.value)} placeholder="搜索候选值" aria-label="搜索候选值"/>
      <div className="shadcn-scrollbar mt-2 max-h-60 overflow-y-auto">{state.values.map(value=>{
        const selected=values.includes(value);
        const disabled=!selected && values.length>=100;
        return <label key={value} className={`flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-slate-700 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-slate-100"}`}>
          <Checkbox aria-label={`选择候选值 ${value || "（空字符串）"}`} checked={selected} disabled={disabled} onCheckedChange={checked=>onChange(checked ? [...values,value] : values.filter(item=>item!==value))} />
          <span className="min-w-0 truncate" title={value || "（空字符串）"}>{value || "（空字符串）"}</span>
        </label>;
      })}</div>
      {state.message && <p role="status" className="py-3 text-xs leading-5 text-slate-500">{state.message}</p>}
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2"><span className="text-xs text-slate-400">已选 {values.length} 项，最多 100 项</span><Button variant="outline" size="sm" onClick={()=>setOpen(false)}>完成</Button></div>
    </PopoverContent>
  </Popover>;
}
