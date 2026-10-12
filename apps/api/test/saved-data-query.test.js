const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("@eureka-atlas/database");
const { SavedDataQueryService } = require("../dist/query/saved-data-query.service");
const { SavedDataQueryController } = require("../dist/query/saved-data-query.controller");
const { QueryCompilerService } = require("../dist/query/query-compiler.service");
const { AuthGuard } = require("../dist/auth/auth.guard");
const { AuthService } = require("../dist/auth/auth.service");
const { UnauthorizedException } = require("@nestjs/common");
const { APP_GUARD } = require("@nestjs/core");
const { Test } = require("@nestjs/testing");

const semantic = storage => ({content_version:"v1",source:{type:"MAXCOMPUTE",project:"p"},table:{id:"table",name:"sales",business_name:"销售",query_config:{storage,default_stat_date:{field_id:"date",format:"yyyyMMdd"}}},fields:[{id:"date",name:"日期",column:"ds",type:"PARTITION",is_partition:true,normalized_type:"STRING",groupable:false},{id:"shop",name:"店铺",column:"shop",type:"DIMENSION",normalized_type:"STRING",groupable:true},{id:"amount",name:"金额",column:"amount",type:"METRIC",normalized_type:"DECIMAL",aggregation:"SUM"}],metrics:[]});
const config = () => ({table_id:"table",mode:"DETAIL",field_ids:["shop","amount"],filters:[{field_id:"date",preset:"LAST_N_DAYS",days:7},{field_id:"shop",operator:"EQ",values:["A"],logic:"OR"}],order_by:[{field_id:"amount",direction:"DESC"}]});
function fixture(t,storage="DATE_INCREMENTAL") {
  const rows=new Map(), undo=[];let seq=0;const pkg=semantic(storage);
  const patch=(object,key,value)=>{const old=object[key];object[key]=value;undo.push(()=>object[key]=old);};
  const matches=(row,where)=>row.ownerMemberNo===where.ownerMemberNo && (!where.id || row.id===where.id) && (!where.name || row.name.toLowerCase().includes(where.name.contains.toLowerCase()));
  patch(prisma.savedDataQuery,"create",async({data})=>{const now=new Date(Date.now()+seq);const row={...data,id:"saved-"+(++seq),createdAt:now,updatedAt:now};rows.set(row.id,row);return row;});
  patch(prisma.savedDataQuery,"findFirst",async({where})=>[...rows.values()].find(row=>matches(row,where)) ?? null);
  patch(prisma.savedDataQuery,"updateMany",async({where,data})=>{const row=rows.get(where.id);if(!row || !matches(row,where))return {count:0};Object.assign(row,data,{updatedAt:new Date(Date.now()+1000)});return {count:1};});
  patch(prisma.savedDataQuery,"deleteMany",async({where})=>{const row=rows.get(where.id);return {count:row && matches(row,where) && rows.delete(row.id)?1:0};});
  patch(prisma.savedDataQuery,"count",async({where})=>[...rows.values()].filter(row=>matches(row,where)).length);
  patch(prisma.savedDataQuery,"findMany",async({where,skip,take,orderBy})=>{assert.deepEqual(orderBy,[{updatedAt:"desc"},{id:"desc"}]);return [...rows.values()].filter(row=>matches(row,where)).sort((a,b)=>b.updatedAt-a.updatedAt || b.id.localeCompare(a.id)).slice(skip,skip+take);});
  patch(prisma,"$transaction",operations=>Promise.all(operations));
  patch(prisma.queryExecution,"deleteMany",()=>{throw new Error("must not touch execution records");});
  patch(prisma.queryExecution,"create",()=>{throw new Error("must not execute a query");});
  t.after(()=>undo.reverse().forEach(fn=>fn()));
  const packages={get:async id=>{assert.equal(id,"table");return pkg;}};
  return {rows,pkg,packages,service:new SavedDataQueryService(packages,new QueryCompilerService())};
}

test("configuration round-trip, update, save-as and restart retain ownership and relative dates without execution",async t=>{
  const f=fixture(t);const cfg=config();cfg.idempotency_key="not-persisted";cfg.token="not-persisted";cfg.filters[1].extra="not-persisted";
  const item=await f.service.create("A",{name:" 近7天销售 ",config:cfg,ownerMemberNo:"B"});
  assert.equal(item.name,"近7天销售");assert.equal(f.rows.get(item.id).ownerMemberNo,"A");assert.equal(item.table_name,"销售");assert.equal(item.config.filters[0].preset,"LAST_N_DAYS");assert.equal(item.config.filters[0].days,7);
  assert.ok(!JSON.stringify(item).includes("not-persisted"));assert.ok(!("sql" in item));assert.ok(!("ownerMemberNo" in item));
  const fresh=new SavedDataQueryService(f.packages,new QueryCompilerService());assert.deepEqual((await fresh.get("A",item.id)).config,item.config);
  const next=config();next.filters[1].values=["B"];await fresh.update("A",item.id,{name:"更新",config:next});assert.equal((await f.service.get("A",item.id)).config.filters[1].values[0],"B");
  const copy=await fresh.create("A",{name:"更新",config:next});assert.notEqual(copy.id,item.id);assert.equal(f.rows.size,2);
  await fresh.remove("A",item.id);assert.equal(f.rows.size,1);assert.equal((await fresh.get("A",copy.id)).name,"更新");
});

test("all operations isolate accounts, reject empty identity and paginate/search only own saved queries",async t=>{
  const f=fixture(t),a=await f.service.create("A",{name:"A",config:config()});await f.service.create("B",{name:"B",config:config()});
  for(const action of [()=>f.service.get("B",a.id),()=>f.service.update("B",a.id,{name:"x",config:config()}),()=>f.service.remove("B",a.id),()=>f.service.get("A","missing")])await assert.rejects(action,e=>e.getStatus()===404);
  await assert.rejects(()=>f.service.list(""),e=>e.getStatus()===401);
  for(let i=0;i<22;i++)await f.service.create("A",{name:"销售"+i,config:config()});
  const p1=await f.service.list("A","销售",1),p2=await f.service.list("A","销售",2);assert.equal(p1.total,22);assert.equal(p1.items.length,20);assert.equal(p2.items.length,2);assert.equal(new Set([...p1.items,...p2.items].map(item=>item.id)).size,22);
  assert.equal((await f.service.list("B")).items.length,1);assert.equal((await f.service.list("A","missing")).total,0);
  for(const args of [["",0,20],["",1,101],["",1.5,20]])await assert.rejects(()=>f.service.list("A",...args),e=>e.getStatus()===400);
});

test("configuration validation is offline for snapshot tables but real execution still requires a snapshot",async t=>{
  const f=fixture(t,"FULL_SNAPSHOT"),cfg={...config(),filters:[{field_id:"shop",operator:"EQ",values:["A"]}]};
  const compiler=new QueryCompilerService();assert.doesNotThrow(()=>compiler.validateDataQuery(f.pkg,cfg));assert.throws(()=>compiler.compileDataQuery(f.pkg,cfg),/最新有效分区/);
  const saved=await f.service.create("A",{name:"快照",config:cfg});assert.deepEqual((await f.service.get("A",saved.id)).validation_errors,[]);
  const aggregate={...cfg,mode:"AGGREGATE"};assert.doesNotThrow(()=>compiler.validateDataQuery(f.pkg,aggregate));
  assert.throws(()=>compiler.validateDataQuery(f.pkg,{...cfg,filters:[{field_id:"date",preset:"YESTERDAY"}]}),/快照日期/);
});

test("invalid configuration fails saving; changed semantics retain the original config and report invalid fields",async t=>{
  const f=fixture(t);
  for(const name of ["", " ", "x".repeat(61)])await assert.rejects(()=>f.service.create("A",{name,config:config()}),e=>e.getStatus()===400);
  const cases=[{...config(),field_ids:[]},{...config(),field_ids:["missing"]},{...config(),filters:[]},{...config(),filters:[{field_id:"date",preset:"LAST_N_DAYS",days:0}]},{...config(),order_by:[{field_id:"missing",direction:"DESC"}]},{...config(),mode:"AGGREGATE",field_ids:["shop"]}];
  for(const cfg of cases)await assert.rejects(()=>f.service.create("A",{name:"bad",config:cfg}),e=>e.getStatus()===400);
  const item=await f.service.create("A",{name:"原配置",config:config()});f.pkg.content_version="v2";f.pkg.fields=f.pkg.fields.filter(field=>field.id!=="shop");
  const loaded=await f.service.get("A",item.id);assert.equal(loaded.current_content_version,"v2");assert.equal(loaded.content_version,"v1");assert.ok(loaded.validation_errors.length);assert.deepEqual(loaded.config.field_ids,["shop","amount"]);
});

test("saved query HTTP routes use the global login and origin guard, including PATCH and DELETE",async t=>{
  const f=fixture(t);const module=await Test.createTestingModule({controllers:[SavedDataQueryController],providers:[{provide:SavedDataQueryService,useValue:f.service},{provide:AuthService,useValue:{authenticate:async req=>{const member=req.get("cookie");if(!["A","B"].includes(member))throw new UnauthorizedException();return {member_no:member};}}},{provide:APP_GUARD,useClass:AuthGuard}]}).compile();
  const app=module.createNestApplication({logger:false});app.setGlobalPrefix("api");await app.listen(0,"127.0.0.1");t.after(()=>app.close());const base=await app.getUrl();
  const request=(path,member,method="GET",body,cross=false)=>fetch(base+"/api/saved-data-queries"+path,{method,headers:{...(member?{Cookie:member}:{}),"Content-Type":"application/json",...(cross?{"Sec-Fetch-Site":"cross-site"}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const body={name:"销售",config:config()};
  for(const [path,method] of [["","GET"],["","POST"],["/x","GET"],["/x","PATCH"],["/x","DELETE"]])assert.equal((await request(path,null,method,method==="POST"||method==="PATCH"?body:undefined)).status,401);
  const created=await request("","A","POST",body);assert.equal(created.status,201);const item=await created.json();
  for(const method of ["GET","PATCH","DELETE"])assert.equal((await request("/"+item.id,"B",method,method==="PATCH"?body:undefined)).status,404);
  for(const method of ["POST","PATCH","DELETE"])assert.equal((await request(method==="POST"?"":"/"+item.id,"A",method,method==="DELETE"?undefined:body,true)).status,403);
  assert.equal((await request("/"+item.id,"A","PATCH",{...body,name:"更新"})).status,200);
  assert.equal((await (await request("","A")).json()).items.length,1);
  assert.equal((await request("/"+item.id,"A","DELETE")).status,200);
});
