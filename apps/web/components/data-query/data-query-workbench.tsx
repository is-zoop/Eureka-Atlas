"use client";
import { useEffect, useRef, useState } from "react";
import type { DataQueryExecution, DataQueryFilter, DataQueryMode, DataQueryRequest, DataQueryResultPage, SemanticPackage, SemanticSelectableTablesResponse } from "@eureka-atlas/types";
import { ArrowDownWideNarrow, ChevronDown, ChevronRight, CircleAlert, CircleHelp, Clock3, Code2, Database, Download, Info, ListFilter, LoaderCircle, Play, RotateCcw, Search, TableProperties, X } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DatasetSelector } from "./dataset-selector";
import { QueryFilters } from "./query-filters";
import { defaultFilters, outputFields } from "./model";

const isTerminal = (status:string) => ["SUCCEEDED","FAILED","CANCELLED","TIMED_OUT"].includes(status);
const statusName:Record<string,string> = {PENDING:"提交中",RUNNING:"执行／完整读取中",SUCCEEDED:"已完成",FAILED:"失败",CANCELLING:"取消中",CANCELLED:"已取消",TIMED_OUT:"已超时"};
const setQueryUrl = (id?:string) => {const url=new URL(window.location.href);if(id)url.searchParams.set("queryId",id);else url.searchParams.delete("queryId");window.history.replaceState(null,"",url);};
export function DataQueryWorkbench() {
  const [tables,setTables]=useState<SemanticSelectableTablesResponse>({items:[],groups:[]});
  const [pkg,setPackage]=useState<SemanticPackage|null>(null),[tableId,setTableId]=useState("");
  const [mode,setMode]=useState<DataQueryMode>("DETAIL"),[selected,setSelected]=useState<string[]>([]),[filters,setFilters]=useState<DataQueryFilter[]>([]);
  const [sortId,setSortId]=useState(""),[direction,setDirection]=useState<"ASC"|"DESC">("DESC");
  const [search,setSearch]=useState(""),[closed,setClosed]=useState<string[]>([]);
  const [execution,setExecution]=useState<DataQueryExecution|null>(null),[data,setData]=useState<DataQueryResultPage|null>(null);
  const [page,setPage]=useState(1),[size,setSize]=useState(100),[error,setError]=useState(""),[busy,setBusy]=useState(true),[retry,setRetry]=useState(0),[clock,setClock]=useState(()=>Date.now()),[bootKey,setBootKey]=useState(0);
  const scope=useRef(new AbortController());
  const requestKey=useRef<{json:string;key:string}|null>(null);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return ()=>clearInterval(timer);},[]);
  useEffect(()=>{
    const controller=new AbortController();scope.current=controller;
    void (async()=>{
      try {
        const list=await api<SemanticSelectableTablesResponse>("/semantic/queryable-tables",{signal:controller.signal});setTables(list);
        const id=new URL(window.location.href).searchParams.get("queryId");
        if(id) {
          const task=await api<DataQueryExecution>("/data-queries/"+encodeURIComponent(id),{signal:controller.signal});
          const semantic=await api<SemanticPackage>("/packages/"+task.table_id,{signal:controller.signal});
          controller.signal.throwIfAborted();
          setTableId(task.table_id);setPackage(semantic);setMode(task.request.mode);setSelected(task.request.field_ids);setFilters(task.request.filters ?? []);setSortId(task.request.order_by?.[0]?.field_id ?? "");setDirection(task.request.order_by?.[0]?.direction ?? "DESC");setExecution(task);
        }
      }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error ? cause.message : "加载失败");}
      finally{if(!controller.signal.aborted)setBusy(false);}
    })();
    return ()=>scope.current.abort();
  },[bootKey]);
  useEffect(()=>{
    if(!execution || isTerminal(execution.status))return;
    const controller=new AbortController();
    const timer=setTimeout(()=>void api<DataQueryExecution>("/data-queries/"+execution.id,{signal:AbortSignal.any([controller.signal,scope.current.signal])}).then(setExecution).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);}),1500);
    return ()=>{controller.abort();clearTimeout(timer);};
  },[execution,retry]);
  useEffect(()=>{
    if(execution?.status!=="SUCCEEDED" || new Date(execution.expires_at).getTime()<=Date.now())return;
    const controller=new AbortController();
    void api<DataQueryResultPage>("/data-queries/"+execution.id+"/result?page="+page+"&pageSize="+size,{signal:AbortSignal.any([controller.signal,scope.current.signal])}).then(setData).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);});
    return ()=>controller.abort();
  },[execution,page,size,retry]);
  const chooseTable=async(id:string)=>{
    scope.current.abort();const controller=new AbortController();scope.current=controller;
    setTableId(id);setPackage(null);setSelected([]);setFilters([]);setSortId("");setMode("DETAIL");setExecution(null);setData(null);setPage(1);setSearch("");setError("");setBusy(true);requestKey.current=null;setQueryUrl();
    try{const semantic=await api<SemanticPackage>("/packages/"+id,{signal:controller.signal});controller.signal.throwIfAborted();setPackage(semantic);setFilters(defaultFilters(semantic));}
    catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error ? cause.message : "加载失败");}
    finally{if(!controller.signal.aborted)setBusy(false);}
  };
  const fields=pkg ? outputFields(pkg,mode) : [];
  const toggle=(id:string)=>{const next=selected.includes(id)?selected.filter(item=>item!==id):[...selected,id];setSelected(next);if(sortId===id && !next.includes(id))setSortId("");};
  const changeMode=(value:string)=>{
    if(!pkg)return;const next=value as DataQueryMode;const allowed=new Set(outputFields(pkg,next).filter(field=>!field.disabled).map(field=>field.id));
    setMode(next);setSelected(selected.filter(id=>allowed.has(id)));if(!allowed.has(sortId))setSortId("");
  };
  const submit=async()=>{
    if(!pkg)return;setBusy(true);setError("");setData(null);setExecution(null);
    const controller=scope.current;
    const input:DataQueryRequest={table_id:tableId,mode,field_ids:selected,filters,order_by:sortId?[{field_id:sortId,direction}]:[]};
    const json=JSON.stringify(input);if(requestKey.current?.json!==json)requestKey.current={json,key:crypto.randomUUID()};
    try{const task=await api<DataQueryExecution>("/data-queries",{method:"POST",body:JSON.stringify({...input,idempotency_key:requestKey.current!.key}),signal:controller.signal});controller.signal.throwIfAborted();setExecution(task);setPage(1);setQueryUrl(task.id);requestKey.current=null;}
    catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error ? cause.message : "查询失败");}
    finally{if(!controller.signal.aborted)setBusy(false);}
  };
  const cancel=async()=>{
    if(!execution)return;
    try{const task=await api<DataQueryExecution>("/data-queries/"+execution.id+"/cancel",{method:"POST",signal:scope.current.signal});setExecution(task);}
    catch(cause){if(!scope.current.signal.aborted)setError(cause instanceof Error ? cause.message : "取消失败");}
  };
  const running=execution && !isTerminal(execution.status);
  const expired=execution && new Date(execution.expires_at).getTime()<=clock;
  const canRun=pkg?.source.type==="MAXCOMPUTE" && selected.length && (mode==="DETAIL" || selected.some(id=>pkg.fields.find(field=>field.id===id)?.type==="METRIC" || pkg.metrics.some(metric=>metric.id===id)));
  const matchingFields = fields.filter(field => [field.name, field.column].some(text => text.toLowerCase().includes(search.trim().toLowerCase())));
  const modeLabel = mode === "DETAIL" ? "明细查询" : "汇总查询";
  return <div className="flex min-h-[calc(100dvh-110px)] flex-col gap-4 lg:h-[calc(100dvh-110px)] lg:min-h-0">
    {error && <Alert variant="destructive" className="shrink-0"><CircleAlert /><AlertDescription>{error}</AlertDescription><AlertAction>
      <Button variant="outline" size="sm" onClick={()=>{setError("");setRetry(retry+1);if(!pkg && tableId)void chooseTable(tableId);else if(!pkg)setBootKey(bootKey+1);}}>重试</Button>
      {!pkg && <Button variant="ghost" size="sm" onClick={()=>{setQueryUrl();setError("");}}>返回本人数据查询</Button>}
    </AlertAction></Alert>}
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <Card className="flex min-h-0 flex-col overflow-hidden rounded-xl shadow-none">
        <aside aria-label="数据集与字段" className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-slate-100 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Database className="size-4 text-slate-400" />数据集</h2>
              <div className="flex items-center gap-2">
                <label htmlFor="data-query-mode" className="cursor-pointer text-xs text-slate-500">{modeLabel}</label>
                <Switch id="data-query-mode" aria-label={modeLabel} checked={mode==="AGGREGATE"} disabled={!pkg || busy || !!running} onCheckedChange={aggregate=>changeMode(aggregate ? "AGGREGATE" : "DETAIL")} />
                <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="查询模式说明" className="text-slate-400 hover:text-slate-700"><CircleHelp className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="right" className="max-w-xs">{mode==="DETAIL" ? "明细查询：返回原始数据，不聚合、不去重。" : "汇总查询：按治理指标口径与计算公式汇总。"}</TooltipContent></Tooltip></TooltipProvider>
              </div>
            </div>
            <DatasetSelector tables={tables} value={tableId} onChange={id=>void chooseTable(id)} />
          </div>
          {pkg ? <>
            <div className="shrink-0 px-4 pt-4">
              <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">输出字段<Badge className="bg-slate-100 px-1.5 font-normal text-slate-500">{selected.length} 已选</Badge></h2><Button variant="ghost" size="xs" disabled={!selected.length} className="text-slate-400" onClick={()=>{setSelected([]);setSortId("");}}>清空</Button></div>
              <InputGroup className="h-9 border-slate-200 shadow-none"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput className="h-full pl-9" aria-label="搜索输出字段" value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索字段名称或物理字段" /></InputGroup>
            </div>
            <div className="shadcn-scrollbar max-h-96 min-h-0 flex-1 overflow-y-auto px-3 py-3 lg:max-h-none">
              {[["METRIC","指标"],["DIMENSION","维度"],["LABEL","标签"],["PARTITION","分区"]].map(([group,label])=>{
                const visible=matchingFields.filter(field=>field.group===group);
                if (!visible.length) return null;
                const expanded=!!search.trim() || !closed.includes(group);
                return <section key={group} className="mb-2 last:mb-0">
                  <Button variant="ghost" className="h-8 w-full justify-start px-2 text-xs text-slate-500" aria-expanded={expanded} onClick={()=>setClosed(expanded?[...closed,group]:closed.filter(item=>item!==group))}>{expanded?<ChevronDown className="size-3" />:<ChevronRight className="size-3" />}{label}<span className="ml-auto tabular-nums text-slate-400">{visible.length}</span></Button>
                  {expanded && visible.map(field=><label key={field.id} className={`flex min-h-6 items-center gap-2 rounded-md px-2 py-1.5 text-sm leading-5 transition-colors ${field.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-slate-50"} ${selected.includes(field.id) ? "bg-slate-100" : ""}`}>
                    <Checkbox aria-label={field.name} checked={selected.includes(field.id)} disabled={field.disabled} onCheckedChange={()=>toggle(field.id)} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-700" title={field.name}>{field.name}</span>
                    <span className="max-w-32 shrink truncate text-right text-xs text-slate-400" title={`${field.column}${field.disabled ? " · "+(field.column==="计算指标"?"仅汇总模式可选":"未开放分组") : ""}`}>{field.column}{field.disabled && ` · ${field.column==="计算指标"?"仅汇总模式可选":"未开放分组"}`}</span>
                  </label>)}
                </section>;
              })}
              {!matchingFields.length && <p className="py-8 text-center text-xs text-slate-400">没有匹配的字段</p>}
            </div>
            <div className="shrink-0 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs leading-5 text-slate-400">{mode==="DETAIL"?"勾选字段作为结果列，按选择顺序展示。":"选择指标及分组维度，按正式治理口径汇总。"}</div>
          </> : <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            {busy ? <LoaderCircle className="size-5 animate-spin text-slate-400" /> : <TableProperties className="size-6 text-slate-300" />}
            <p className="text-xs leading-6 text-slate-400">{busy ? "正在加载数据集…" : "选择数据集后，在此勾选查询字段"}</p>
          </div>}
        </aside>
      </Card>
      <section aria-label="查询工作台" className="shadcn-scrollbar flex min-h-0 min-w-0 flex-col gap-4 lg:overflow-y-auto">
        {!pkg ? <Card className="flex min-h-96 flex-1 flex-col rounded-xl shadow-none">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-800"><TableProperties className="size-4 text-slate-400" />查询工作台</div>
          <EmptyState icon={Database} title={busy ? "正在准备数据集" : "选择一个数据集，开始查询"} description="从左侧选择已发布的数据集，勾选输出字段，设置筛选条件后即可查询。支持明细、汇总及 Excel 导出。" />
        </Card> : <>
          <Card className="shrink-0 rounded-xl shadow-none">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><ListFilter className="size-4 text-slate-400" />查询配置</h2>
              <Button variant="ghost" size="sm" className="text-slate-500" disabled={busy || !!running} onClick={()=>void chooseTable(tableId)}><RotateCcw className="size-3.5" />新建查询</Button>
            </div>
            <div className="px-5 py-4">
              <QueryFilters key={tableId} pkg={pkg} filters={filters} onChange={setFilters} />
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
              <ArrowDownWideNarrow className="size-4 text-slate-400" /><span className="mr-1 text-xs text-slate-500">排序</span>
              <Combobox aria-label="排序字段" className="h-9 w-44" inputClassName="h-9 border-slate-200 shadow-none" value={sortId} options={[{value:"",label:"不排序"},...fields.filter(field=>selected.includes(field.id)).map(field=>({value:field.id,label:field.name}))]} onValueChange={setSortId} />
              <Combobox aria-label="排序方向" className="h-9 w-24" inputClassName="justify-between border border-slate-200 bg-white px-3" searchable={false} disabled={!sortId} value={direction} options={[{value:"ASC",label:"升序"},{value:"DESC",label:"降序"}]} onValueChange={value=>setDirection(value as "ASC"|"DESC")} />
              <div className="ml-auto flex items-center gap-2">{running && <Button variant="outline" disabled={execution?.status==="CANCELLING"} onClick={()=>void cancel()}><X className="size-4" />取消</Button>}<Button disabled={!canRun || busy || !!running} onClick={()=>void submit()}>{busy || running ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}{running ? "查询中" : "查询"}</Button></div>
            </div>
            {pkg.source.type!=="MAXCOMPUTE" && <p className="flex items-center gap-2 px-5 py-3 text-xs text-amber-600"><Info className="size-4" />当前仅支持 MaxCompute 数据源执行查询。</p>}
            {mode==="AGGREGATE" && selected.length>0 && !canRun && pkg.source.type==="MAXCOMPUTE" && <p className="px-5 py-3 text-xs text-amber-600">汇总查询需要至少选择一个指标。</p>}
          </Card>
          <Card className="flex min-h-96 min-w-0 flex-1 flex-col overflow-hidden rounded-xl shadow-none">
            <Tabs defaultValue="data" className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-3"><h2 className="text-sm font-semibold text-slate-800">查询结果</h2><TabsList className="h-8 border-0 bg-slate-100"><TabsTrigger className="h-6 gap-1.5 px-2.5 text-xs" value="data"><TableProperties className="size-3.5" />数据</TabsTrigger><TabsTrigger className="h-6 gap-1.5 px-2.5 text-xs" value="sql"><Code2 className="size-3.5" />SQL</TabsTrigger></TabsList></div>
                <Button variant="outline" size="sm" disabled={execution?.status!=="SUCCEEDED" || !!expired} onClick={()=>window.open("/api/data-queries/"+execution!.id+"/export","_blank","noopener,noreferrer")}><Download className="size-3.5" />Excel 下载</Button>
              </div>
              {execution && <div aria-live="polite" className="shrink-0 space-y-2 border-b border-slate-100 bg-slate-50/50 px-5 py-3 text-xs text-slate-500">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Badge className={execution.status==="SUCCEEDED" ? "bg-emerald-50 font-medium text-emerald-700" : ["FAILED","TIMED_OUT"].includes(execution.status) ? "bg-rose-50 font-medium text-rose-700" : "bg-slate-100 font-medium text-slate-600"}>{running && <LoaderCircle className="mr-1.5 size-3 animate-spin" />}{statusName[execution.status]}</Badge>
                  <span className="whitespace-nowrap tabular-nums">耗时 {((execution.elapsed_ms ?? 0)/1000).toFixed(1)} 秒</span>
                  <span className="whitespace-nowrap tabular-nums">已保存 {execution.row_count.toLocaleString()} 行</span>
                  <span className="max-w-xs truncate text-slate-400" title={`语义版本 ${execution.content_version}`}>语义版本 {execution.content_version}</span>
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-right tabular-nums">
                    {execution.snapshot_date && <span className="whitespace-nowrap">快照日期 {execution.snapshot_date}</span>}
                    {execution.resolved_dates.map(range=><span key={range.field_id} className="whitespace-nowrap">实际日期：{range.start} 至 {range.end}（Asia/Shanghai）</span>)}
                  </div>
                </div>
                {execution.error && <p className="text-rose-600">{execution.error}</p>}
                {execution.truncated && <p className="flex items-center gap-1.5 text-amber-600"><Info className="size-3.5 shrink-0" />结果超过 20 万行，仅保存并导出前 200,000 行。</p>}
                {expired && <p className="text-amber-600">结果已过期，请重新查询。</p>}
              </div>}
              <TabsContent value="sql" className="mt-0 flex-1 p-4"><pre className="shadcn-scrollbar max-h-[55dvh] flex-1 overflow-auto rounded-lg border border-slate-100 bg-slate-50 p-4 text-xs leading-6 whitespace-pre-wrap text-slate-600">{execution?.sql ?? "查询提交后，将在此展示实际执行的只读 SQL。"}</pre></TabsContent>
              <TabsContent value="data" className="mt-0 flex-1">
                {data && !expired ? <>
                  <Table containerClassName="max-h-[55dvh] min-h-0 flex-1 rounded-none border-0" className="min-w-full">
                    <thead><tr><TableHead className="w-14 text-center font-medium">#</TableHead>{data.columns.map((column,index)=><TableHead key={index} className={`whitespace-nowrap font-medium ${["INTEGER","DECIMAL"].includes(column.type) ? "text-right" : ""}`}>{column.name}</TableHead>)}</tr></thead>
                    <tbody>{data.rows.map((row,index)=><tr key={index}><TableCell className="text-center tabular-nums text-slate-400">{(page-1)*size+index+1}</TableCell>{row.map((cell,i)=><TableCell key={i} className={`max-w-96 break-words ${["INTEGER","DECIMAL"].includes(data.columns[i]?.type) ? "text-right tabular-nums" : ""}`}>{cell===null ? <span className="italic text-slate-400">NULL</span> : String(cell)}</TableCell>)}</tr>)}</tbody>
                  </Table>
                  {!data.rows.length && <EmptyState icon={Search} title="没有符合条件的数据" description="当前筛选范围内没有记录，请调整日期或筛选条件后重新查询。" />}
                  <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3"><span className="text-xs tabular-nums text-slate-500">共 {data.total.toLocaleString()} 行 · 第 {page} / {Math.max(1,data.total_pages)} 页</span><Pagination currentPage={page} totalPages={data.total_pages} onPageChange={value=>{if(value!==page){setData(null);setPage(value);}}} pageSize={size} pageSizeOptions={[50,100,200,500].map(value=>({value,label:value+" 行/页"}))} onPageSizeChange={value=>{if(value!==size){setData(null);setPage(1);setSize(value);}}} /></footer>
                </> : running || (execution?.status==="SUCCEEDED" && !expired) ? <div role="status" className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 p-8 text-center"><LoaderCircle className="size-6 animate-spin text-slate-400" /><p className="text-sm font-medium text-slate-700">{running ? "正在执行查询并读取完整结果" : "正在加载分页结果"}</p>{running && <p className="text-xs text-slate-400">任务在后台运行，离开页面不会取消查询。</p>}</div> : <EmptyState icon={expired ? Clock3 : execution ? CircleAlert : TableProperties} title={expired ? "查询结果已过期" : execution ? statusName[execution.status] : "等待查询结果"} description={expired ? "结果保留 24 小时，重新查询即可获取最新数据。" : execution ? "请检查查询配置或错误信息，再次点击查询重试。" : "在左侧勾选输出字段，设置筛选条件后点击「查询」，结果将在这里展示。"} />}
              </TabsContent>
            </Tabs>
          </Card>
        </>}
      </section>
    </div>
  </div>;
}
