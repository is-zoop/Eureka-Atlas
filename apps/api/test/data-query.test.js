const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("@eureka-atlas/database");
const { QueryCompilerService } = require("../dist/query/query-compiler.service");
const { DataQueryService } = require("../dist/query/data-query.service");
const { QueryExecutionService } = require("../dist/query/query-execution.service");
const { DataQueryExportService } = require("../dist/query/data-query-export.service");
const { resolveDate } = require("../dist/query/data-query-dates");
const { PassThrough } = require("node:stream");
const ExcelJS = require("exceljs");
const pkg = (storage="DATE_INCREMENTAL") => ({
 content_version:"v1",source:{id:"source",type:"MAXCOMPUTE",project:"p"},table:{id:"table",name:"sales",query_config:{storage,default_stat_date:{field_id:"date",format:"yyyyMMdd"}}},
 fields:[{id:"date",name:"统计日期",column:"ds",type:"PARTITION",is_partition:true,normalized_type:"STRING",groupable:false},
 {id:"shop",name:"店铺",column:"shop",type:"DIMENSION",normalized_type:"STRING",groupable:true,candidate_value_queryable:true},
 {id:"amount",name:"金额",column:"amount",type:"METRIC",normalized_type:"DECIMAL",aggregation:"SUM",unit:"元"},
 {id:"time",name:"业务时间",column:"time",type:"DIMENSION",normalized_type:"DATETIME",groupable:true}],
 metrics:[{id:"derived",name:"计算金额",formula:"SUM(amount) * 2",unit:"元"}]
});
const input = (mode="DETAIL",field_ids=["shop","amount"])=>({table_id:"table",mode,field_ids,filters:[{field_id:"date",preset:"CUSTOM",start:"2026-10-01",end:"2026-10-09"}]});
test("data compiler keeps detail raw, aggregates governed metrics, and never expands ask",()=>{
 const c=new QueryCompilerService();
 const detail=c.compileDataQuery(pkg(),input());
 assert.doesNotMatch(detail.sql,/SUM|DISTINCT|GROUP BY/);assert.match(detail.sql,/LIMIT 200001/);
 const aggregate=c.compileDataQuery(pkg(),input("AGGREGATE",["shop","derived"]));
 assert.match(aggregate.sql,/SUM\(amount\) \* 2/);assert.match(aggregate.sql,/GROUP BY/);
 assert.throws(()=>c.compileDataQuery(pkg(),input("DETAIL",["derived"])),/仅支持汇总/);
 assert.throws(()=>c.compileDataQuery(pkg(),input("AGGREGATE",["shop"])),/至少选择一个指标/);
 assert.throws(()=>c.compileDataQuery(pkg(),input("AGGREGATE",["date","amount"])),/不能用于分组/);
 assert.throws(()=>c.compileDataQuery(pkg(),{...input(),table_id:"other"}),/当前单表/);
 assert.throws(()=>c.compileDataQuery(pkg(),input("DETAIL",["other"])),/不属于当前表/);
 assert.throws(()=>c.compileDataQuery(pkg(),{...input(),filters:[]}),/必须选择默认统计日期/);
 assert.throws(()=>c.compileDataQuery(pkg(),{...input(),filters:[...input().filters,{field_id:"amount",operator:"GT",values:["1; DROP TABLE x"]}]}),/数字筛选值/);
 assert.throws(()=>c.compileQuery(pkg(),{table_id:"table",metric_ids:["amount"],limit:200000}),/5000/);
});
test("dates end yesterday in Shanghai, validate calendar days and include full datetime end",()=>{
 const now=new Date("2026-10-09T17:00:00Z");
 assert.deepEqual(resolveDate({preset:"LAST_7_DAYS"},now),{start:"2026-10-03",end:"2026-10-09"});
 assert.deepEqual(resolveDate({preset:"LAST_N_DAYS",days:30},now),{start:"2026-09-10",end:"2026-10-09"});
 assert.throws(()=>resolveDate({preset:"CUSTOM",start:"2026-02-30",end:"2026-03-01"}),/有效/);
 assert.throws(()=>resolveDate({preset:"LAST_N_DAYS",days:0}),/整数/);
 const c=new QueryCompilerService();
 const sql=c.compileDataQuery(pkg(),{...input(),filters:[...input().filters,{field_id:"time",preset:"CUSTOM",start:"2026-10-01",end:"2026-10-09"}]}).sql;
 assert.ok(sql.includes(">= '2026-10-01 00:00:00'"));assert.ok(sql.includes("< '2026-10-10 00:00:00'"));
 const snapshot=c.compileDataQuery(pkg("FULL_SNAPSHOT"),{...input(),filters:[]},{snapshotDate:"20261009"});
 assert.ok(snapshot.sql.includes("= '20261009'"));
 assert.throws(()=>c.compileDataQuery(pkg("FULL_SNAPSHOT"),input(),{snapshotDate:"20261009"}),/快照日期/);
 assert.throws(()=>c.compileDataQuery(pkg(),{...input(),filters:[...input().filters,{field_id:"shop",preset:"YESTERDAY"}]}),/未配置日期/);
});
function fixture() {
 const undo=[];const replace=(obj,key,fn)=>{const before=obj[key];obj[key]=fn;undo.push(()=>obj[key]=before);};
 const now=new Date();const jobs=new Map();const chunks=new Map();const calls={cancel:[],reads:0};
 const match=(row,where)=>Object.entries(where||{}).every(([key,value])=>key==="ownerMemberNo_idempotencyKey" ? match(row,value) : value && typeof value==="object" && "in" in value ? value.in.includes(row[key]) : row[key]===value);
 replace(prisma.queryExecution,"findUnique",async({where})=>[...jobs.values()].find(row=>match(row,where))||null);
 replace(prisma.queryExecution,"create",async({data})=>{const row={id:"q"+jobs.size,status:"PENDING",submittedAt:now,startedAt:null,completedAt:null,error:null,result:null,resultRowCount:0,resultBytes:0,truncated:false,...data};jobs.set(row.id,row);return row;});
 replace(prisma.queryExecution,"update",async({where,data})=>{Object.assign(jobs.get(where.id),data);return jobs.get(where.id);});
 replace(prisma.queryExecution,"updateMany",async({where,data})=>{let count=0;for(const row of jobs.values())if(match(row,where)){Object.assign(row,data);count++;}return {count};});
 replace(prisma.queryExecution,"findMany",async({where})=>[...jobs.values()].filter(row=>match(row,where)));
 replace(prisma.queryResultChunk,"create",async({data})=>{const key=data.queryExecutionId+":"+data.chunkIndex;assert.ok(!chunks.has(key));chunks.set(key,data);return data;});
 replace(prisma.queryResultChunk,"deleteMany",async({where})=>{let count=0;for(const [key,row] of chunks){if(where.queryExecutionId===row.queryExecutionId || where.execution && jobs.get(row.queryExecutionId).expiresAt<=where.execution.expiresAt.lte){chunks.delete(key);count++;}}return {count};});
 replace(prisma.queryResultChunk,"findMany",async({where})=>[...chunks.values()].filter(row=>row.queryExecutionId===where.queryExecutionId && row.chunkIndex>=where.chunkIndex.gte && row.chunkIndex<=(where.chunkIndex.lte ?? where.chunkIndex.lt-1)).sort((a,b)=>a.chunkIndex-b.chunkIndex));
 const compiler=new QueryCompilerService();
 const queries=new QueryExecutionService({get:async()=>pkg("FULL_SNAPSHOT")},{},compiler);
 queries.resolveSnapshot=async()=> "20261009";
 queries.clientFor=async()=>({submitSql:async()=> "remote",getInstance:async()=>({status:"SUCCEEDED"}),cancelInstance:async(id)=>{calls.cancel.push(id);}});
 queries.projectFor=async()=>"p";
 const reader={async *read(){calls.reads++;yield [["1"]];}};
 const service=new DataQueryService({get:async()=>pkg("FULL_SNAPSHOT")},compiler,queries,{getWithCredentials:async()=>({connectionConfig:{endpoint:"https://mock"},credentials:{accessKey:"secret",secretKey:"secret"}})},reader);
 const add=(id,owner="A",status="RUNNING")=>{const row={id,kind:"DATA_QUERY",ownerMemberNo:owner,status,metaTableId:"table",dataSourceId:"source",remoteInstanceId:"remote",submittedAt:new Date(),expiresAt:new Date(Date.now()+86400000),request:{...input("DETAIL",["amount"]),filters:[]},sql:"SELECT amount",contentVersion:"v1",snapshotDate:null,resolvedDates:[],resultColumns:[{id:"amount",name:"金额",type:"DECIMAL",unit:"元"}],resultRowCount:0,truncated:false};jobs.set(id,row);return row;};
 return {service,reader,queries,jobs,chunks,calls,add,close(){undo.reverse().forEach(fn=>fn());}};
}
test("full reader persists empty, >10k, >5MB, exactly 200k and extra row without silent truncation",async()=>{
 const f=fixture();
 try {
  for(const [total,width] of [[0,0],[12001,512],[200000,0],[200001,0]]) {
   const row=f.add("q"+total);
   f.reader.read=async function*(){for(let offset=0;offset<total;offset+=1000)yield Array.from({length:Math.min(1000,total-offset)},(_,i)=>[String(offset+i)+"x".repeat(width)]);};
   await f.service.refresh(row.id);
   assert.equal(row.status,"SUCCEEDED");assert.equal(row.resultRowCount,Math.min(total,200000));assert.equal(row.truncated,total>200000);
   if(width)assert.ok(row.resultBytes>5*1024*1024);
   let received=0;
   for(let page=1;page<=Math.max(1,Math.ceil(row.resultRowCount/500));page++){const result=await f.service.result("A",row.id,page,500);for(const value of result.rows){assert.equal(value[0],String(received++)+"x".repeat(width));}}
   assert.equal(received,row.resultRowCount);assert.equal((await f.service.get("A",row.id)).result,undefined);
   if(total===200001) {
    const stream=new PassThrough(),buffers=[];stream.on("data",buffer=>buffers.push(buffer));
    await new DataQueryExportService(f.service).write("A",row,stream);
    const zip=require(require.resolve("jszip",{paths:[require.resolve("exceljs")]}));
    const archive=await zip.loadAsync(Buffer.concat(buffers));const sheet=await archive.file("xl/worksheets/sheet1.xml").async("string");
    assert.equal((sheet.match(/<row /g)||[]).length,200001);assert.ok(sheet.includes("199999"));
   }
  }
 } finally {f.close();}
});
test("permissions, failure, timeout, cancellation, restart and expiry never expose partial rows",async()=>{
 const f=fixture();
 try {
  for(const message of ["完整结果读取权限不足","读取失败"]) {
   const row=f.add(message);f.reader.read=async function*(){yield Array.from({length:1000},()=>["1"]);throw new Error(message);};
   await f.service.refresh(row.id);assert.equal(row.status,"FAILED");assert.equal(row.error,message);assert.equal([...f.chunks.values()].filter(chunk=>chunk.queryExecutionId===row.id).length,0);
   await assert.rejects(f.service.result("A",row.id),/尚未读取/);
  }
  const expired=f.add("timeout");expired.submittedAt=new Date(Date.now()-600001);await f.service.refresh(expired.id);assert.equal(expired.status,"TIMED_OUT");await new Promise(resolve=>setImmediate(resolve));assert.ok(f.calls.cancel.length);
  const cancelled=f.add("cancel");await f.service.cancel("A",cancelled.id);assert.equal(cancelled.status,"CANCELLED");
  const restart=f.add("restart");f.chunks.set("restart:0",{queryExecutionId:"restart",chunkIndex:0,rows:[["partial"]]});
  f.reader.read=async function*(){yield [["9007199254740993"],["1234567890.12345678901234567890"]];};
  await f.service.refresh(restart.id);assert.equal(restart.status,"SUCCEEDED");assert.deepEqual((await f.service.result("A",restart.id)).rows,[["9007199254740993"],["1234567890.12345678901234567890"]]);
  restart.expiresAt=new Date(Date.now()-1);await assert.rejects(f.service.result("A",restart.id),/已过期/);await f.service.tick();assert.equal([...f.chunks.values()].filter(c=>c.queryExecutionId==="restart").length,0);
 }finally{f.close();}
});
test("owner checks cover state, pages, cancel, export, legacy and account-scoped idempotency",async()=>{
 const f=fixture();
 try {
  f.add("A","A","SUCCEEDED");f.add("B","B","SUCCEEDED");f.add("legacy",null,"SUCCEEDED");
  for(const id of ["B","legacy","missing"]){
   for(const operation of [()=>f.service.get("A",id),()=>f.service.result("A",id),()=>f.service.cancel("A",id),()=>f.service.ready("A",id)])await assert.rejects(operation(),error=>error.getStatus()===404);
  }
  await assert.rejects(f.service.get(undefined,"A"),error=>error.getStatus()===401);
  const request={...input("DETAIL",["amount"]),filters:[],idempotency_key:"same"};
  const a=await f.service.submit("A",request),b=await f.service.submit("B",request);assert.notEqual(a.id,b.id);
  assert.equal((await f.service.submit("A",request)).id,a.id);
  await assert.rejects(f.service.submit("A",{...request,field_ids:["shop"]}),error=>error.getStatus()===409);
  await assert.rejects(f.queries.cancel("B",a.id),error=>error.getStatus()===404);
  const single=f.add("excel","A","SUCCEEDED");single.resultRowCount=10001;
  for(let offset=0;offset<10001;offset+=1000)f.chunks.set("excel:"+offset/1000,{queryExecutionId:"excel",chunkIndex:offset/1000,rows:Array.from({length:Math.min(1000,10001-offset)},(_,i)=>[offset+i===0 ? null : offset+i===1 ? "[NULL]" : offset+i===2 ? "=CMD()" : String(offset+i)])});
  const stream=new PassThrough();const buffers=[];stream.on("data",buffer=>buffers.push(buffer));
  await new DataQueryExportService(f.service).write("A",single,stream);
  const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.concat(buffers));
  assert.equal(book.getWorksheet("数据").rowCount,10002);assert.equal(book.getWorksheet("数据").getCell("A2").value,null);assert.equal(book.getWorksheet("数据").getCell("A3").value,"[NULL]");assert.equal(book.getWorksheet("数据").getCell("A4").value,"'=CMD()");
 }finally{f.close();}
});
test("Excel preserves Chinese and precision while exporting null as a blank cell rather than a marker",async()=>{
 const columns=[{name:"店铺名称",type:"STRING"},{name:"金额",type:"DECIMAL"},{name:"空值",type:"STRING"},{name:"备注",type:"STRING"},{name:"布尔值",type:"BOOLEAN"}];
 const rows=[["香影官方旗舰店-日常","12345678901234567890.123456789",null,"",false],["ELLE女装艾世天猫outlet店-日常","9007199254740993","NULL","[NULL]",true],["中文与 emoji 😀","0",null,"=CMD()",false]];
 const queries={async *rows(member,id){assert.equal(member,"A");assert.equal(id,"excel-unicode");yield* rows;}};
 const item={id:"excel-unicode",resultColumns:columns,contentVersion:"v1",snapshotDate:null,resultRowCount:rows.length,truncated:false,request:{filters:[]},resolvedDates:[],sql:"SELECT 店铺名称"};
 const stream=new PassThrough(),buffers=[];stream.on("data",buffer=>buffers.push(buffer));
 await new DataQueryExportService(queries).write("A",item,stream);
 const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.concat(buffers));const data=book.getWorksheet("数据");
 assert.deepEqual(data.getRow(1).values.slice(1),columns.map(column=>column.name));
 for(let index=0;index<rows.length;index++){
  assert.equal(data.getCell(index+2,1).value,rows[index][0]);assert.equal(data.getCell(index+2,2).value,rows[index][1]);assert.equal(data.getCell(index+2,3).value,rows[index][2]);assert.equal(data.getCell(index+2,5).value,rows[index][4]);
 }
 assert.equal(data.getCell("D2").value,"");assert.equal(data.getCell("D3").value,"[NULL]");assert.equal(data.getCell("D4").value,"'=CMD()");
 assert.equal(data.getCell("C2").value,null);assert.equal(data.getCell("C3").value,"NULL");assert.equal(data.getCell("C4").value,null);
 const notes=book.getWorksheet("查询说明");const noteRows=[];notes.eachRow(row=>noteRows.push(row.values));assert.ok(noteRows.some(row=>row[1]==="空值"&&row[2].includes("空白单元格")));
});

test("candidate values remove own condition, retain others and belong to requester",async()=>{
 const f=fixture();
 try{
  let captured;f.queries.dimensionValuesPackage=async(member,semantic,request,complete)=>{captured={member,request,complete};return {id:"candidate"};};
  await f.service.dimensionValues("B",{table_id:"table",field_id:"shop",filters:[{field_id:"shop",operator:"EQ",values:["self"]},{field_id:"amount",operator:"GT",values:["1"]}],keyword:"搜索"});
  assert.equal(captured.member,"B");assert.equal(captured.request.limit,200);assert.equal(captured.complete,true);assert.deepEqual(captured.request.filters,[{field_id:"amount",operator:"GT",values:["1"]}]);
 }finally{f.close();}
});

test("HTTP endpoints require login, reject cross-account pages/cancel/export and reject cross-site writes",async()=>{
 const f=fixture();const undo=[];const authRows=new Map();const replace=(object,key,value)=>{const old=object[key];object[key]=value;undo.push(()=>object[key]=old);};
 const {Test}=require("@nestjs/testing"),{APP_GUARD}=require("@nestjs/core");
 const {AuthController}=require("../dist/auth/auth.controller"),{AuthService}=require("../dist/auth/auth.service"),{AuthGuard}=require("../dist/auth/auth.guard"),{HazeAuthService}=require("../dist/auth/haze-auth.service"),{CredentialCryptoService}=require("../dist/datasource/credential-crypto.service");
 const {DataQueryController}=require("../dist/query/data-query.controller"),{QueryController}=require("../dist/query/query.controller");
 const profile=member=>({member_no:member,name:member,phone:"13800000001",status:"active",email:null,avatar_url:null,department:""});
 replace(prisma.authSession,"create",async({data})=>{authRows.set(data.id,data);return data;});
 replace(prisma.authSession,"findUnique",async({where})=>authRows.get(where.id)||null);
 replace(prisma.authSession,"deleteMany",async()=>({count:0}));
 f.service.onModuleInit=()=>{};f.service.onModuleDestroy=()=>{};
 const module=await Test.createTestingModule({controllers:[AuthController,DataQueryController,QueryController],providers:[AuthService,{provide:HazeAuthService,useValue:{login:async(phone)=>({user:profile(phone==="13800000001"?"A":"B"),token:phone==="13800000001"?"A":"B",expiresIn:3600}),me:async(token)=>profile(token)}},{provide:CredentialCryptoService,useValue:{encrypt:token=>"encrypted:"+token,decrypt:token=>token.slice(10)}},{provide:APP_GUARD,useClass:AuthGuard},{provide:DataQueryService,useValue:f.service},{provide:QueryExecutionService,useValue:f.queries},{provide:DataQueryExportService,useValue:{write:async(_,__,response)=>response.end("mock")}}]}).compile();
 const app=module.createNestApplication({logger:false});app.setGlobalPrefix("api");await app.listen(0,"127.0.0.1");const base=await app.getUrl();
 const request=(url,cookie,method="GET",body,origin)=>fetch(base+"/api"+url,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{"Content-Type":"application/json"}:{}),...(origin?{Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  const login=async(member)=>{const response=await request("/auth/login",null,"POST",{phone:member==="A"?"13800000001":"13800000002",password:"mock-password"});assert.equal(response.status,200);return response.headers.get("set-cookie").split(";")[0];};
  const a=await login("A"),b=await login("B");const row=f.add("private","A","SUCCEEDED");row.resultRowCount=1;f.chunks.set("private:0",{queryExecutionId:"private",chunkIndex:0,rows:[["1"]]});
  for(const path of ["/data-queries/private","/data-queries/private/result","/data-queries/private/export","/queries/private"]){assert.equal((await request(path)).status,401);assert.equal((await request(path,b)).status,404);assert.equal((await request(path,a)).status,200);}
  assert.equal((await request("/data-queries/private/cancel",b,"POST")).status,404);
  assert.equal((await request("/data-queries/private/cancel",a,"POST",{}, "https://evil.example")).status,403);
  assert.equal((await request("/data-queries/private/result?pageSize=1000",a)).status,400);
  assert.equal((await request("/data-queries/private/result?page=2&pageSize=50",a)).status,200);
  const body=await (await request("/data-queries/private",a)).json();assert.equal(body.result,undefined);assert.doesNotMatch(JSON.stringify(body),/secret|encrypted:/);
 }finally{await app.close();undo.reverse().forEach(fn=>fn());f.close();}
});

test("deadline and active cancellation abort the reader, clear partial chunks and stop remote work",async()=>{
 const f=fixture();
 try{
  for(const timeout of [true,false]) {
   let began;const started=new Promise(resolve=>began=resolve);const row=f.add(timeout?"reading-timeout":"reading-cancel");
   if(timeout)row.submittedAt=new Date(Date.now()-599950);
   f.reader.read=async function*(_,signal){yield Array.from({length:1000},()=>["1"]);began();await new Promise((_,reject)=>{if(signal.aborted)reject(new Error("aborted"));else signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true});});};
   const running=f.service.refresh(row.id);await started;
   if(!timeout)await f.service.cancel("A",row.id);
   await running;await new Promise(resolve=>setImmediate(resolve));
   assert.equal(row.status,timeout?"TIMED_OUT":"CANCELLED");assert.equal([...f.chunks.values()].filter(chunk=>chunk.queryExecutionId===row.id).length,0);
  }
  assert.equal(f.calls.cancel.length,2);
 }finally{f.close();}
});
