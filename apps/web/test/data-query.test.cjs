/* eslint-disable @typescript-eslint/no-require-imports -- Component tests without a browser. */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
const read=name=>fs.readFileSync(path.join(__dirname,"../components/data-query",name),"utf8");
const transpile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const model={exports:{}};new Function("require","module","exports",transpile(read("model.ts")))(require,model,model.exports);
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);return tree && typeof tree==="object"?[tree,...nodes(tree.props?.children)]:[];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join("");return tree && typeof tree==="object"?text(tree.props?.children):tree==null || typeof tree==="boolean"?"":String(tree);}
const fixture=id=>({source:{type:"MAXCOMPUTE"},table:{id,query_config:{storage:"DATE_INCREMENTAL",default_stat_date:{field_id:"ds",format:"yyyyMMdd"}}},fields:[{id:"ds",name:"统计日期",column:"ds",type:"PARTITION",normalized_type:"STRING",groupable:false},{id:"gmv",name:"销售额",column:"gmv",type:"METRIC",normalized_type:"DECIMAL"},{id:"shop",name:"店铺",column:"shop",type:"DIMENSION",normalized_type:"STRING",groupable:true,candidate_value_queryable:true},{id:"label",name:"标签",column:"label",type:"LABEL",normalized_type:"STRING",groupable:true}],metrics:[{id:"formula",name:"计算指标",formula:"SUM(gmv)"}]});
function mount(file,exportName,props={},api=async()=>({items:[],groups:[]})){
 const slots=[];let cursor=0,pending=[],tree;
 const react={useState(initial){const i=cursor++;slots[i]??={value:typeof initial==="function"?initial():initial};return [slots[i].value,value=>slots[i].value=typeof value==="function"?value(slots[i].value):value];},useRef(initial){const i=cursor++;slots[i]??={current:initial};return slots[i];},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,n)=>!Object.is(v,old.deps[n])))pending.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});}};
 const component={exports:{}};
 const win={location:{href:"http://localhost/query/data"},history:{replaceState(_,__,url){win.location.href=String(url);}},open(){}};
 const localRequire=name=>name==="react"?react:name==="react/jsx-runtime"?require(name):name==="./model"?model.exports:name==="@/lib/api"?{api}:name==="@/lib/utils"?{cn:(...values)=>values.filter(Boolean).join(" ")}:new Proxy({},{get:(_,key)=>key});
 new Function("require","module","exports","window",transpile(read(file)))(localRequire,component,component.exports,win);
 return {render(){cursor=0;tree=component.exports[exportName](props);pending.splice(0).forEach(fn=>fn());return tree;},node(predicate){return nodes(tree).find(predicate);},button(label){return nodes(tree).find(node=>node.type==="Button"&&text(node)===label);},window:win,unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const savedFixture=(id="one",table="A",cfg)=>({id,name:"近7天销售",table_name:"销售",content_version:"v1",created_at:"2026-10-10T00:00:00Z",updated_at:"2026-10-10T00:00:00Z",config:cfg ?? {table_id:table,mode:"DETAIL",field_ids:["gmv"],filters:[{field_id:"ds",preset:"LAST_7_DAYS"}],order_by:[]},current_content_version:"v1",validation_errors:[]});

test("saved query search reserves icon space and cannot shrink in the drawer",()=>{
 const view=mount("saved-queries-sheet.tsx","SavedQueriesSheet",{open:false,refresh:0,onOpenChange(){},onSelect(){},onDeleted(){}});
 try{view.render();const group=view.node(node=>node.type==="InputGroup"),input=view.node(node=>node.props?.["aria-label"]==="搜索我的查询");assert.match(group.props.className,/\bh-9\b/);assert.match(group.props.className,/\bshrink-0\b/);assert.match(input.props.className,/\bh-full\b/);assert.match(input.props.className,/\bpl-9\b/);assert.equal(nodes(group).filter(node=>node.type==="InputGroupAddon").length,1);}finally{view.unmount();}
});

test("save dialog trims and validates names, pre-fills updates and offers save-as without losing failed input",()=>{
 const actions=[];const props={open:true,name:" ",existing:false,saving:false,error:"",onOpenChange:()=>{},onNameChange:value=>props.name=value,onSave:asNew=>actions.push(asNew)};
 const view=mount("save-query-dialog.tsx","SaveQueryDialog",props);
 try{view.render();assert.equal(view.node(node=>node.type==="Button"&&node.props.type==="submit").props.disabled,true);props.name="x".repeat(61);view.render();assert.equal(view.node(node=>node.type==="Button"&&node.props.type==="submit").props.disabled,true);props.name=" 销售 ";props.existing=true;view.render();assert.equal(view.node(node=>node.type==="Input").props.value," 销售 ");view.button("另存为新查询").props.onClick();view.node(node=>node.type==="form").props.onSubmit({preventDefault(){}});assert.deepEqual(actions,[true,false]);props.error="服务不可用";view.render();assert.equal(view.node(node=>node.type==="Input").props.value," 销售 ");assert.ok(view.node(node=>node.props?.role==="alert"));props.saving=true;view.render();assert.equal(view.button("另存为新查询").props.disabled,true);}finally{view.unmount();}
});

test("toolbar is ordered and available before table selection; saving updates or copies a named config without executing",async()=>{
 const writes=[];let seq=0;const api=async(url,options)=>{if(url==="/semantic/queryable-tables")return {items:[],groups:[]};if(url==="/packages/A")return fixture("A");if(options?.method){assert.ok(url.startsWith("/saved-data-queries"));const body=JSON.parse(options.body);writes.push({url,method:options.method,...body});return {...savedFixture(options.method==="POST"?"saved-"+(++seq):url.split("/").at(-1)),name:body.name,config:body.config};}return {};};
 const view=mount("data-query-workbench.tsx","DataQueryWorkbench",{},api),dialog=()=>view.node(node=>node.type==="SaveQueryDialog");
 try{view.render();await flush();view.render();const buttons=nodes(view.render()).filter(node=>node.type==="Button").map(text);assert.deepEqual(buttons.filter(name=>["新建查询","保存查询","我的查询"].includes(name)),["新建查询","保存查询","我的查询"]);assert.equal(view.button("保存查询").props.disabled,true);view.button("我的查询").props.onClick();view.render();assert.equal(view.node(node=>node.type==="SavedQueriesSheet").props.open,true);
  view.node(node=>node.type==="DatasetSelector").props.onChange("A");await flush();view.render();view.node(node=>node.type==="Checkbox"&&node.props["aria-label"]==="销售额").props.onCheckedChange();view.render();view.button("保存查询").props.onClick();view.render();assert.equal(dialog().props.open,true);dialog().props.onNameChange("常用销售");view.render();dialog().props.onSave(false);await flush();view.render();assert.equal(writes[0].method,"POST");assert.equal(writes[0].name,"常用销售");assert.ok(view.window.location.href.includes("savedQueryId=saved-1"));assert.ok(!view.node(node=>node.type==="Badge"&&text(node)==="未保存修改"));
  view.node(node=>node.type==="QueryFilters").props.onChange([{field_id:"ds",preset:"LAST_7_DAYS"}]);view.render();assert.ok(view.node(node=>node.type==="Badge"&&text(node)==="未保存修改"));view.button("保存查询").props.onClick();view.render();assert.equal(dialog().props.name,"常用销售");dialog().props.onSave(false);await flush();view.render();assert.equal(writes[1].method,"PATCH");assert.equal(writes[1].url,"/saved-data-queries/saved-1");assert.equal(writes[1].config.filters[0].preset,"LAST_7_DAYS");
  view.button("保存查询").props.onClick();view.render();dialog().props.onNameChange("副本");view.render();dialog().props.onSave(true);await flush();view.render();assert.equal(writes[2].method,"POST");assert.ok(view.window.location.href.includes("savedQueryId=saved-2"));
 }finally{view.unmount();}
});

test("opening a saved config clears task URL and results, reports stale fields and ignores superseded loads",async()=>{
 let release;const slow=new Promise(resolve=>release=resolve);const calls=[];const bad=savedFixture("bad","A",{table_id:"A",mode:"DETAIL",field_ids:["missing","gmv"],filters:[{field_id:"ds",preset:"YESTERDAY"}],order_by:[]});
 const api=async(url,options)=>{calls.push([url,options]);if(url==="/semantic/queryable-tables")return {items:[],groups:[]};if(url==="/saved-data-queries/slow")return slow;if(url==="/saved-data-queries/bad")return bad;if(url==="/packages/A")return fixture("A");return {};};
 const view=mount("data-query-workbench.tsx","DataQueryWorkbench",{},api);
 try{view.render();await flush();view.render();view.window.history.replaceState(null,"","http://localhost/query/data?queryId=old");view.node(node=>node.type==="SavedQueriesSheet").props.onSelect("slow");view.render();view.node(node=>node.type==="SavedQueriesSheet").props.onSelect("bad");await flush();view.render();release(savedFixture("slow","B"));await flush();view.render();assert.equal(view.node(node=>node.type==="QueryFilters").props.pkg.table.id,"A");assert.ok(view.window.location.href.includes("savedQueryId=bad"));assert.ok(!view.window.location.href.includes("queryId="));assert.equal(view.button("保存查询").props.disabled,true);assert.ok(view.node(node=>node.props?.["aria-label"]==="移除失效字段 missing"));view.node(node=>node.props?.["aria-label"]==="移除失效字段 missing").props.onClick();view.render();assert.equal(view.button("保存查询").props.disabled,false);assert.ok(calls.find(([url,options])=>url==="/saved-data-queries/slow"&&options.signal.aborted));assert.ok(!calls.some(([url])=>url.includes("/cancel")||url==="/data-queries"));}finally{view.unmount();}
});

test("unsaved navigation can cancel, discard, or save before continuing; save failure preserves the pending action",async()=>{
 let fail=true;const api=async(url,options)=>{if(url==="/semantic/queryable-tables")return {items:[],groups:[]};if(url.startsWith("/packages/"))return fixture(url.split("/").at(-1));if(options?.method==="POST"){if(fail)throw new Error("保存失败");return {...savedFixture("saved"),...JSON.parse(options.body)};}return {};};
 const view=mount("data-query-workbench.tsx","DataQueryWorkbench",{},api);
 try{view.render();await flush();view.render();view.node(node=>node.type==="DatasetSelector").props.onChange("A");await flush();view.render();view.node(node=>node.type==="Checkbox"&&node.props["aria-label"]==="销售额").props.onCheckedChange();view.render();view.node(node=>node.type==="DatasetSelector").props.onChange("B");view.render();view.button("取消").props.onClick();view.render();assert.equal(view.node(node=>node.type==="QueryFilters").props.pkg.table.id,"A");
  view.node(node=>node.type==="DatasetSelector").props.onChange("B");view.render();view.button("保存后继续").props.onClick();view.render();let dialog=view.node(node=>node.type==="SaveQueryDialog");dialog.props.onNameChange("保存后切换");view.render();view.node(node=>node.type==="SaveQueryDialog").props.onSave(false);await flush();view.render();dialog=view.node(node=>node.type==="SaveQueryDialog");assert.equal(dialog.props.error,"保存失败");assert.equal(dialog.props.name,"保存后切换");assert.equal(dialog.props.open,true);fail=false;dialog.props.onSave(false);await flush();view.render();assert.equal(view.node(node=>node.type==="QueryFilters").props.pkg.table.id,"B");assert.equal(view.node(node=>node.type==="SaveQueryDialog").props.saving,false);assert.ok(!view.window.location.href.includes("savedQueryId"));
 }finally{view.unmount();}
});

test("refresh prioritizes execution request over saved config and marks differences as unsaved",async()=>{
 const stored=savedFixture(),task={id:"run",table_id:"A",status:"CANCELLED",expires_at:new Date(Date.now()+86400000).toISOString(),request:{...stored.config,field_ids:["shop"]},row_count:0,resolved_dates:[],content_version:"v1"};
 const api=async url=>url==="/semantic/queryable-tables"?{items:[],groups:[]}:url==="/saved-data-queries/one"?stored:url==="/data-queries/run"?task:fixture("A");
 const view=mount("data-query-workbench.tsx","DataQueryWorkbench",{},api);view.window.location.href="http://localhost/query/data?savedQueryId=one&queryId=run";
 try{view.render();await flush();view.render();assert.equal(view.node(node=>node.type==="Checkbox"&&node.props["aria-label"]==="店铺").props.checked,true);assert.equal(view.node(node=>node.type==="Checkbox"&&node.props["aria-label"]==="销售额").props.checked,false);assert.ok(view.node(node=>node.type==="Badge"&&text(node)==="未保存修改"));view.button("保存查询").props.onClick();view.render();assert.equal(view.node(node=>node.type==="SaveQueryDialog").props.existing,true);}finally{view.unmount();}
});

test("saved query drawer searches, paginates, deletes with confirmation and never executes the selected query",async()=>{
 const calls=[],selected=[],deleted=[];const props={open:true,refresh:0,onOpenChange:value=>props.open=value,onSelect:id=>selected.push(id),onDeleted:id=>deleted.push(id)};
 const api=async(url,options)=>{calls.push([url,options]);if(options?.method==="DELETE")return {success:true};return {items:[savedFixture("one")],total:21,total_pages:2,page:url.includes("page=2")?2:1,page_size:20};};
 const view=mount("saved-queries-sheet.tsx","SavedQueriesSheet",props,api);const settle=async()=>{await new Promise(resolve=>setTimeout(resolve,280));await flush();view.render();};
 try{view.render();await settle();assert.match(view.node(node=>node.type==="SheetContent").props.className,/sm:max-w-\[420px\]/);view.node(node=>node.type==="Pagination").props.onPageChange(2);view.render();await settle();assert.ok(calls.some(([url])=>url.includes("page=2")));view.node(node=>node.props?.["aria-label"]==="搜索我的查询").props.onChange({target:{value:"销售"}});view.render();await settle();assert.ok(calls.some(([url])=>url.includes("keyword="+encodeURIComponent("销售"))&&url.includes("page=1")));view.node(node=>node.type==="DropdownMenuItem").props.onSelect();view.render();assert.equal(calls.filter(([,options])=>options?.method==="DELETE").length,0);view.button("确认删除").props.onClick();await flush();view.render();await settle();assert.deepEqual(deleted,["one"]);view.node(node=>node.type==="Button"&&text(node).startsWith("近7天销售")).props.onClick();assert.deepEqual(selected,["one"]);assert.equal(props.open,false);assert.ok(calls.every(([url])=>url.startsWith("/saved-data-queries")));}finally{view.unmount();}
});

test("missing filter fields remain visible and editable; a missing required date can be explicitly restored",()=>{
 const props={pkg:fixture("A"),filters:[{field_id:"missing",operator:"EQ",values:["A"]}],onChange:next=>props.filters=next};const view=mount("query-filters.tsx","QueryFilters",props);
 try{view.render();assert.ok(text(view.render()).includes("missing 已失效"));view.node(node=>node.props?.["aria-label"]==="筛选字段 1").props.onValueChange("shop");view.render();assert.equal(props.filters[0].field_id,"shop");view.button("补充必填统计日期").props.onClick();view.render();assert.equal(props.filters[0].field_id,"ds");assert.equal(props.filters[0].preset,"YESTERDAY");}finally{view.unmount();}
});
test("dataset Command groups use unique IDs, searchable keywords and close after a single selection",()=>{
 const {defaultFilter}=require("cmdk");
 const chosen=[];const tables={items:[{id:"A",business_name:"销售",physical_name:"sales",data_domain:"电商"},{id:"B",business_name:"库存",physical_name:"stock",data_domain:null},{id:"C",business_name:"销售",physical_name:"sales_archive",data_domain:"历史"}],groups:[{data_domain:"电商",tables:[{id:"A",business_name:"销售",physical_name:"sales"}]},{data_domain:null,tables:[{id:"B",business_name:"库存",physical_name:"stock"}]},{data_domain:"历史",tables:[{id:"C",business_name:"销售",physical_name:"sales_archive"}]}]};
 const view=mount("dataset-selector.tsx","DatasetSelector",{tables,value:"A",onChange:id=>chosen.push(id)});
 try{
  let tree=view.render();
  const command=view.node(node=>node.type==="Command");assert.equal(command.props.defaultValue,"A");assert.equal(command.props.loop,true);
  const groups=nodes(tree).filter(node=>node.type==="CommandGroup");assert.deepEqual(groups.map(node=>text(node.props.heading)),["电商","未分类","历史"]);
  const items=nodes(tree).filter(node=>node.type==="CommandItem");assert.deepEqual(items.map(node=>node.props.value),["A","B","C"]);
  assert.equal(nodes(items[0]).filter(node=>node.type==="Check").length,1);assert.equal(nodes(items[1]).filter(node=>node.type==="Check").length,0);
  const matches=query=>items.filter(node=>defaultFilter(node.props.value,query,node.props.keywords)>0).map(node=>node.props.value);
  assert.deepEqual(matches("SALES"),["A","C"]);assert.deepEqual(matches("库存"),["B"]);assert.deepEqual(matches("电商"),["A"]);assert.deepEqual(matches("未分类"),["B"]);assert.deepEqual(matches("no-match"),[]);
  view.node(node=>node.type==="Popover").props.onOpenChange(true);view.render();
  view.node(node=>node.type==="CommandItem"&&node.props.value==="B").props.onSelect("B");view.render();assert.deepEqual(chosen,["B"]);assert.equal(view.node(node=>node.type==="Popover").props.open,false);
  assert.ok(view.node(node=>node.type==="CommandInput"));assert.ok(view.node(node=>node.type==="CommandEmpty"));
 }finally{view.unmount();}
});
test("empty dataset Command provides an empty state without selectable groups",()=>{
 const view=mount("dataset-selector.tsx","DatasetSelector",{tables:{items:[],groups:[]},value:"",onChange:()=>{throw new Error("must not select");}});
 try{
  const tree=view.render();assert.equal(nodes(tree).filter(node=>node.type==="CommandItem").length,0);
  assert.match(text(view.node(node=>node.type==="CommandEmpty")),/暂无已发布/);
  assert.equal(view.node(node=>node.props?.role==="combobox").props["aria-expanded"],false);
 }finally{view.unmount();}
});
test("field groups and mode rules preserve physical selections but remove derived/non-groupable",()=>{
 const pkg=fixture("A");assert.deepEqual(model.exports.outputFields(pkg,"DETAIL").map(field=>field.group),["PARTITION","METRIC","DIMENSION","LABEL","METRIC"]);
 assert.equal(model.exports.outputFields(pkg,"DETAIL").find(field=>field.id==="formula").disabled,true);
 assert.equal(model.exports.outputFields(pkg,"AGGREGATE").find(field=>field.id==="ds").disabled,true);
 assert.deepEqual(model.exports.defaultFilters(pkg),[{field_id:"ds",preset:"YESTERDAY"}]);
 assert.equal(model.exports.dateField(pkg,"shop"),false);
 assert.equal(model.exports.previewDate({preset:"LAST_7_DAYS"},new Date("2026-10-09T17:00:00Z")),"2026-10-03 至 2026-10-09");
});
test("filter controls allow non-output fields, required dates and promote multiple candidate values to IN",()=>{
 let result;const props={pkg:fixture("A"),filters:[{field_id:"ds",preset:"YESTERDAY"},{field_id:"shop",operator:"EQ",values:["one"]}],onChange:next=>result=next};
 const view=mount("query-filters.tsx","QueryFilters",props);
 try{
  let tree=view.render();const candidate=nodes(tree).find(node=>node.type==="CandidateValues");candidate.props.onChange(["two"]);assert.deepEqual(result[1].values,["two"]);assert.equal(result[1].operator,"EQ");
  candidate.props.onChange(["one","two"]);assert.deepEqual(result[1].values,["one","two"]);assert.equal(result[1].operator,"IN");
  props.filters[1]={field_id:"shop",operator:"IN",values:[]};tree=view.render();const multi=nodes(tree).find(node=>node.type==="CandidateValues");multi.props.onChange(["one"]);assert.deepEqual(result[1].values,["one"]);assert.equal(result[1].operator,"IN");
  const dateRow=nodes(tree).find(node=>node.type==="div"&&node.props.className==="flex flex-wrap items-center gap-2"&&nodes(node).some(child=>child.props?.["aria-label"]==="筛选字段 1"));
  const preview=nodes(dateRow).find(node=>node.type==="span"&&text(node).startsWith("实际日期："));assert.ok(preview);assert.match(preview.props.className,/inline-flex/);assert.match(preview.props.className,/whitespace-nowrap/);assert.match(text(preview),/必填/);
  assert.ok(!nodes(tree).some(node=>node.type==="p"&&text(node).startsWith("实际日期：")));
  const date=nodes(tree).find(node=>node.type==="Combobox"&&node.props.value==="YESTERDAY");date.props.onValueChange("LAST_30_DAYS");assert.equal(result[0].preset,"LAST_30_DAYS");
  assert.equal(nodes(tree).filter(node=>node.type==="Button"&&node.props["aria-label"]==="删除筛选")[0].props.disabled,true);
 }finally{view.unmount();}
});
test("date presets keep N editable and show actual date ranges alongside custom dates",()=>{
 const props={pkg:fixture("A"),filters:[{field_id:"ds",preset:"YESTERDAY"}],onChange:next=>props.filters=next};const view=mount("query-filters.tsx","QueryFilters",props);
 try{
  view.render();view.node(node=>node.props?.["aria-label"]==="统计日期日期范围").props.onValueChange("LAST_N_DAYS");view.render();assert.equal(props.filters[0].preset,"LAST_N_DAYS");assert.equal(props.filters[0].days,7);
  view.node(node=>node.props?.["aria-label"]==="近 N 天").props.onChange({target:{value:"13"}});let tree=view.render();assert.equal(props.filters[0].days,13);assert.match(text(tree),/实际日期：/);assert.equal(props.filters[0].start,undefined);
  props.filters=[{field_id:"ds",preset:"CUSTOM",start:"2026-10-01",end:"2026-10-09",days:13}];tree=view.render();assert.match(text(tree),/实际日期：2026-10-01 至 2026-10-09/);assert.doesNotMatch(text(tree),/日期参考：/);assert.equal(view.node(node=>node.props?.["aria-label"]==="近 N 天"),undefined);
 }finally{view.unmount();}
});

test("empty filter inputs and operator changes never introduce an empty-string placeholder",()=>{
 const props={pkg:fixture("A"),filters:[{field_id:"ds",preset:"YESTERDAY"}],onChange:next=>props.filters=next};
 const view=mount("query-filters.tsx","QueryFilters",props);
 const field=()=>view.node(node=>node.props?.["aria-label"]==="筛选字段 2");
 const operator=()=>view.node(node=>node.props?.["aria-label"]==="店铺比较方式");
 const input=()=>view.node(node=>node.type==="Input"&&node.props["aria-label"]==="店铺筛选值");
 try{
  view.render();view.button("添加条件").props.onClick();view.render();field().props.onValueChange("shop");view.render();assert.deepEqual(props.filters[1].values,[]);
  operator().props.onValueChange("IN");view.render();assert.deepEqual(props.filters[1].values,[]);
  input().props.onChange({target:{value:"店铺 A，店铺 B"}});view.render();assert.deepEqual(props.filters[1].values,["店铺 A","店铺 B"]);
  input().props.onChange({target:{value:""}});view.render();assert.deepEqual(props.filters[1].values,[]);
  operator().props.onValueChange("IS_NULL");view.render();operator().props.onValueChange("IN");view.render();assert.deepEqual(props.filters[1].values,[]);
  field().props.onValueChange("shop");view.render();view.node(node=>node.type==="CandidateValues").props.onChange([""]);view.render();operator().props.onValueChange("IN");view.render();assert.deepEqual(props.filters[1].values,[""],"a genuinely selected empty-string candidate is retained");
 }finally{view.unmount();}
});
test("candidate picker stays open across selections, promotes EQ to IN and closes only on explicit dismissal",async()=>{
 const props={pkg:fixture("A"),filters:[{field_id:"ds",preset:"YESTERDAY"}],onChange:next=>props.filters=next};
 const parent=mount("query-filters.tsx","QueryFilters",props);let candidates;
 try{
  parent.render();parent.button("添加条件").props.onClick();parent.render();parent.node(node=>node.props?.["aria-label"]==="筛选字段 2").props.onValueChange("shop");parent.render();assert.equal(props.filters[1].operator,"EQ");
  props.filters.push({field_id:"gmv",operator:"GT",values:["100"]},{field_id:"label",operator:"EQ",values:["旗舰"],logic:"OR"});parent.render();
  const candidateProps={...parent.node(node=>node.type==="CandidateValues").props};
  let requests=0;const api=async(url,options)=>{requests++;const context=JSON.parse(options.body).filters;assert.equal(context[2].logic,"OR");assert.ok(!context.some(filter=>filter.field_id==="shop"));return {id:"candidate-query",status:"SUCCEEDED",result:{rows:[["店铺 A"],["店铺 B"],[""],[null]],truncated:false}};};
  candidates=mount("candidate-values.tsx","CandidateValues",candidateProps,api);
  candidates.render();candidates.node(node=>node.type==="Popover").props.onOpenChange(true);candidates.render();await new Promise(resolve=>setTimeout(resolve,350));candidates.render();
  for(const value of ["店铺 A","店铺 B"]){
   candidates.node(node=>node.type==="Checkbox"&&node.props["aria-label"]==="选择候选值 "+value).props.onCheckedChange(true);parent.render();Object.assign(candidateProps,parent.node(node=>node.type==="CandidateValues").props);candidates.render();
   assert.equal(candidates.node(node=>node.type==="Popover").props.open,true);assert.equal(props.filters[1].operator,value==="店铺 A"?"EQ":"IN");
   const input=parent.node(node=>node.type==="Input"&&node.props["aria-label"]==="店铺筛选值");assert.ok(!input.props.value.startsWith(","));
  }
  assert.deepEqual(props.filters[1].values,["店铺 A","店铺 B"]);assert.equal(parent.node(node=>node.props?.["aria-label"]==="店铺筛选值").props.value,"店铺 A,店铺 B");
  candidates.node(node=>node.type==="Checkbox"&&node.props["aria-label"]==="选择候选值 （空字符串）").props.onCheckedChange(true);parent.render();Object.assign(candidateProps,parent.node(node=>node.type==="CandidateValues").props);candidates.render();assert.deepEqual(props.filters[1].values,["店铺 A","店铺 B",""]);
  candidates.node(node=>node.type==="Checkbox"&&node.props["aria-label"]==="选择候选值 店铺 A").props.onCheckedChange(false);parent.render();Object.assign(candidateProps,parent.node(node=>node.type==="CandidateValues").props);candidates.render();assert.deepEqual(props.filters[1].values,["店铺 B",""]);assert.equal(props.filters[1].operator,"IN");assert.equal(candidates.node(node=>node.type==="Popover").props.open,true);
  assert.equal(requests,1,"selection updates do not restart candidate loading");
  candidates.button("完成").props.onClick();candidates.render();assert.equal(candidates.node(node=>node.type==="Popover").props.open,false);
  candidates.node(node=>node.type==="Popover").props.onOpenChange(true);candidates.render();candidates.node(node=>node.type==="Popover").props.onOpenChange(false);candidates.render();assert.equal(candidates.node(node=>node.type==="Popover").props.open,false);
 }finally{candidates?.unmount();parent.unmount();}
});

test("candidate relation changes abort stale requests and reload under OR without closing the picker",async()=>{
 const props={tableId:"A",fieldId:"shop",filters:[{field_id:"ds",preset:"YESTERDAY"},{field_id:"gmv",operator:"GT",values:["100"]},{field_id:"label",operator:"EQ",values:["旗舰"],logic:"AND"}],values:["已选店铺"],onChange:next=>props.values=next};
 let release;const old=new Promise(resolve=>release=resolve);const calls=[];
 const api=async(url,options)=>{const logic=JSON.parse(options.body).filters[2].logic;calls.push({logic,signal:options.signal});return logic==="AND"?old:{id:"or",status:"SUCCEEDED",result:{rows:[["OR 店铺"]],truncated:false}};};
 const view=mount("candidate-values.tsx","CandidateValues",props,api);
 try{
  view.render();view.node(node=>node.type==="Popover").props.onOpenChange(true);view.render();await new Promise(resolve=>setTimeout(resolve,350));assert.equal(calls[0].logic,"AND");
  props.filters=props.filters.map((filter,index)=>index===2?{...filter,logic:"OR"}:filter);view.render();assert.equal(calls[0].signal.aborted,true);await new Promise(resolve=>setTimeout(resolve,350));view.render();assert.equal(calls[1].logic,"OR");
  release({id:"old",status:"SUCCEEDED",result:{rows:[["过时的 AND 店铺"]],truncated:false}});await flush();const tree=view.render();assert.match(text(tree),/OR 店铺/);assert.doesNotMatch(text(tree),/过时的 AND 店铺/);assert.equal(view.node(node=>node.type==="Popover").props.open,true);assert.deepEqual(props.values,["已选店铺"]);
 }finally{view.unmount();}
});

test("candidate picker caps selections at 100 but allows deselection without closing",async()=>{
 const props={tableId:"A",fieldId:"shop",filters:[],values:Array.from({length:100},(_,index)=>"店铺 "+index),onChange:next=>props.values=next};
 const api=async()=>({id:"candidates",status:"SUCCEEDED",result:{rows:[["店铺 0"],["新增店铺"]],truncated:false}});
 const view=mount("candidate-values.tsx","CandidateValues",props,api);
 const option=value=>view.node(node=>node.type==="Checkbox"&&node.props["aria-label"]==="选择候选值 "+value);
 try{
  view.render();view.node(node=>node.type==="Popover").props.onOpenChange(true);view.render();await new Promise(resolve=>setTimeout(resolve,350));view.render();
  assert.equal(option("新增店铺").props.disabled,true);assert.equal(option("店铺 0").props.disabled,false);
  option("店铺 0").props.onCheckedChange(false);view.render();assert.equal(props.values.length,99);assert.equal(option("新增店铺").props.disabled,false);assert.equal(view.node(node=>node.type==="Popover").props.open,true);
  option("新增店铺").props.onCheckedChange(true);view.render();assert.equal(props.values.length,100);assert.ok(props.values.includes("新增店铺"));assert.equal(view.node(node=>node.type==="Popover").props.open,true);
 }finally{view.unmount();}
});

test("each optional row after the first chooses AND/OR without changing other predicates",()=>{
 const props={pkg:fixture("A"),filters:[{field_id:"ds",preset:"YESTERDAY"},{field_id:"shop",operator:"EQ",values:["店铺 A"]},{field_id:"label",operator:"EQ",values:["旗舰"]},{field_id:"gmv",operator:"GT",values:["100"]}],onChange:next=>props.filters=next};
 const view=mount("query-filters.tsx","QueryFilters",props);const control=index=>view.node(node=>node.type==="Combobox"&&node.props["aria-label"]==="条件关系 "+index);
 try{
  view.render();assert.equal(view.node(node=>node.props?.["aria-label"]==="条件关系"),undefined);assert.equal(control(1),undefined);assert.equal(control(2),undefined);
  assert.equal(control(3).props.value,"AND");assert.deepEqual(control(3).props.options.map(option=>option.value),["AND","OR"]);
  control(3).props.onValueChange("OR");view.render();assert.equal(control(3).props.value,"OR");assert.equal(control(4).props.value,"AND");assert.deepEqual(props.filters[2],{field_id:"label",operator:"EQ",values:["旗舰"],logic:"OR"});assert.equal(props.filters[1].logic,undefined);
  assert.equal(view.node(node=>node.type==="CandidateValues").props.filters[2].logic,"OR");assert.match(text(view.node(node=>node.type==="TooltipContent")),/AND 优先于 OR/);assert.match(text(view.node(node=>node.type==="TooltipContent")),/必填日期和最新快照范围始终生效/);
  const deletes=nodes(view.render()).filter(node=>node.props?.["aria-label"]==="删除筛选");deletes[1].props.onClick();view.render();assert.equal(control(2),undefined);assert.equal(control(3).props.value,"AND");assert.equal(props.filters[1].logic,"OR");
  props.pkg.table.query_config.storage="FULL_SNAPSHOT";props.filters=props.filters.slice(1);view.render();assert.equal(control(1),undefined);assert.equal(control(2).props.value,"AND");
 }finally{view.unmount();}
});
test("row connectors survive changing fields, date presets, comparison operators and values",()=>{
 const pkg=fixture("A");pkg.fields.push({id:"business_date",name:"业务日期",column:"business_date",type:"DIMENSION",normalized_type:"DATE",groupable:true});
 const props={pkg,filters:[{field_id:"ds",preset:"YESTERDAY"},{field_id:"gmv",operator:"GT",values:["100"]},{field_id:"shop",operator:"EQ",values:["A"],logic:"OR"}],onChange:next=>props.filters=next};
 const view=mount("query-filters.tsx","QueryFilters",props);const field=()=>view.node(node=>node.props?.["aria-label"]==="筛选字段 3");
 try{
  view.render();field().props.onValueChange("business_date");view.render();assert.equal(props.filters[2].logic,"OR");
  view.node(node=>node.props?.["aria-label"]==="业务日期日期范围").props.onValueChange("LAST_7_DAYS");view.render();assert.equal(props.filters[2].logic,"OR");assert.equal(props.filters[2].preset,"LAST_7_DAYS");
  view.button("其他比较／空值条件").props.onClick();view.render();assert.equal(props.filters[2].logic,"OR");assert.equal(props.filters[2].operator,"EQ");
  view.button("使用日期预设").props.onClick();view.render();assert.equal(props.filters[2].logic,"OR");assert.equal(props.filters[2].preset,"YESTERDAY");
  field().props.onValueChange("shop");view.render();view.node(node=>node.props?.["aria-label"]==="店铺比较方式").props.onValueChange("IN");view.render();view.node(node=>node.props?.["aria-label"]==="店铺筛选值").props.onChange({target:{value:"A,B"}});view.render();assert.equal(props.filters[2].logic,"OR");assert.deepEqual(props.filters[2].values,["A","B"]);
  view.node(node=>node.props?.["aria-label"]==="条件关系 3").props.onValueChange("AND");view.render();assert.equal(props.filters[2].logic,"AND");
 }finally{view.unmount();}
});

test("filter viewport stays two rows high while extra conditions remain editable inside the scrollbar",()=>{
 const props={pkg:fixture("A"),filters:model.exports.defaultFilters(fixture("A")),onChange:next=>props.filters=next};
 const view=mount("query-filters.tsx","QueryFilters",props);
 try{
  view.render();const height=view.node(node=>node.type==="ScrollArea").props.className;assert.equal(height,"h-[140px]");
  for(let index=0;index<4;index++){
   view.button("添加条件").props.onClick();view.render();const scroll=view.node(node=>node.type==="ScrollArea");
   assert.equal(scroll.props.className,height);assert.equal(scroll.props.type,"auto");assert.equal(scroll.props.scrollbars,"vertical");
   assert.ok(!nodes(scroll).some(node=>node.type==="Button"&&text(node)==="添加条件"));
   assert.equal(nodes(scroll).filter(node=>node.type==="Combobox"&&node.props["aria-label"]?.startsWith("筛选字段 ")).length,props.filters.length);
  }
  view.node(node=>node.props?.["aria-label"]==="筛选字段 5").props.onValueChange("shop");view.render();assert.equal(props.filters[4].field_id,"shop");
  const deletes=nodes(view.render()).filter(node=>node.props?.["aria-label"]==="删除筛选");deletes[4].props.onClick();view.render();assert.equal(props.filters.length,4);assert.equal(view.node(node=>node.type==="ScrollArea").props.className,height);
 }finally{view.unmount();}
});

test("Combobox menus use an anchored portal, retain searchable groups and do not steal input focus",()=>{
 const selected=[];const options=[{value:"date",label:"日期",disabled:true},{value:"gmv",label:"销售额"},{value:"shop",label:"店铺"}];
 const props={value:"shop",options,groups:[{label:"指标",options:[options[1]]},{label:"维度",options:[options[2]]},{label:"分区",options:[options[0]]}],onValueChange:value=>selected.push(value)};
 const view=mount("../ui/combobox.tsx","Combobox",props);
 try{
  view.render();assert.equal(view.node(node=>node.type==="Input").props.value,"店铺");
  view.node(node=>node.type==="Input").props.onFocus();view.render();assert.equal(view.node(node=>node.type==="Root").props.open,true);
  const anchor=view.node(node=>node.type==="Anchor");assert.ok(!nodes(anchor).some(node=>node.props?.role==="listbox"));assert.ok(view.node(node=>node.type==="Portal"));
  const menu=view.node(node=>node.type==="Content");assert.equal(menu.props.role,"listbox");assert.equal(menu.props.side,"bottom");assert.equal(menu.props.align,"start");assert.match(menu.props.className,/radix-popover-trigger-width/);
  let prevented=0;menu.props.onOpenAutoFocus({preventDefault(){prevented++;}});assert.equal(prevented,1);
  const target={};anchor.props.children.props.ref.current={contains:value=>value===target};menu.props.onInteractOutside({detail:{originalEvent:{target}},preventDefault(){prevented++;}});assert.equal(prevented,2);
  menu.props.onInteractOutside({detail:{originalEvent:{target:{}}},preventDefault(){prevented++;}});assert.equal(prevented,2);
  assert.equal(view.node(node=>node.props?.role==="option"&&node.props.disabled).props.disabled,true);
  view.node(node=>node.type==="Input").props.onChange({target:{value:"销售"}});view.render();assert.equal(nodes(view.render()).filter(node=>node.props?.role==="option").length,1);
  view.node(node=>node.props?.role==="option").props.onClick();view.render();assert.deepEqual(selected,["gmv"]);assert.equal(view.node(node=>node.type==="Root").props.open,false);
  props.searchable=false;props.menuPlacement="top";view.render();view.node(node=>node.props?.role==="combobox").props.onClick();view.render();assert.equal(view.node(node=>node.type==="Content").props.side,"top");
  view.node(node=>node.type==="Root").props.onOpenChange(false);view.render();assert.equal(view.node(node=>node.type==="Content"),undefined);
 }finally{view.unmount();}
});

test("adding filters skips the required date and lets optional rows change metrics, dimensions and dates",()=>{
 const pkg=fixture("A");pkg.fields.push({id:"business_date",name:"业务日期",column:"business_date",type:"DIMENSION",normalized_type:"DATE",groupable:true});
 const props={pkg,filters:model.exports.defaultFilters(pkg),onChange:next=>props.filters=next};
 const view=mount("query-filters.tsx","QueryFilters",props);
 const field=index=>view.node(node=>node.type==="Combobox"&&node.props["aria-label"]==="筛选字段 "+index);
 try{
  view.render();view.button("添加条件").props.onClick();view.render();
  assert.deepEqual(props.filters,[{field_id:"ds",preset:"YESTERDAY"},{field_id:"gmv",operator:"EQ",values:[]}]);
  assert.equal(field(1).props.disabled,true);assert.equal(field(2).props.disabled,false);
  assert.equal(field(2).props.options.find(option=>option.value==="ds").disabled,true);
  assert.deepEqual(field(2).props.groups.map(group=>group.label),["指标","维度","标签","分区"]);
  assert.deepEqual(field(2).props.groups.map(group=>group.options.map(option=>option.value)),[["gmv"],["shop","business_date"],["label"],["ds"]]);
  assert.deepEqual(field(2).props.groups.flatMap(group=>group.options),field(2).props.options);
  assert.ok(!field(2).props.options.some(option=>option.value==="formula"));
  field(2).props.onValueChange("shop");view.render();assert.equal(props.filters[1].field_id,"shop");assert.ok(view.node(node=>node.type==="CandidateValues"));
  field(2).props.onValueChange("business_date");view.render();assert.deepEqual(props.filters[1],{field_id:"business_date",preset:"YESTERDAY"});assert.equal(field(2).props.disabled,false);
  field(2).props.onValueChange("gmv");view.render();assert.deepEqual(props.filters[1],{field_id:"gmv",operator:"EQ",values:[]});
  view.button("添加条件").props.onClick();view.render();assert.equal(props.filters[2].field_id,"shop");assert.equal(props.filters.filter(filter=>filter.field_id==="ds").length,1);
  const deletes=nodes(view.render()).filter(node=>node.type==="Button"&&node.props["aria-label"]==="删除筛选");assert.equal(deletes[0].props.disabled,true);assert.equal(deletes[1].props.disabled,false);
  deletes[1].props.onClick();view.render();assert.equal(props.filters[0].field_id,"ds");assert.equal(props.filters.length,2);
 }finally{view.unmount();}
});
test("only one required date row is locked so accidental duplicates can be changed or deleted",()=>{
 const props={pkg:fixture("A"),filters:[{field_id:"ds",preset:"YESTERDAY"},{field_id:"ds",preset:"YESTERDAY"}],onChange:next=>props.filters=next};
 const view=mount("query-filters.tsx","QueryFilters",props);
 try{
  view.render();assert.equal(view.node(node=>node.props?.["aria-label"]==="筛选字段 1").props.disabled,true);assert.equal(view.node(node=>node.props?.["aria-label"]==="筛选字段 2").props.disabled,false);
  const deletes=nodes(view.render()).filter(node=>node.props?.["aria-label"]==="删除筛选");assert.equal(deletes[0].props.disabled,true);assert.equal(deletes[1].props.disabled,false);
  view.node(node=>node.props?.["aria-label"]==="筛选字段 2").props.onValueChange("gmv");view.render();assert.equal(props.filters.filter(filter=>filter.field_id==="ds").length,1);assert.equal(props.filters[1].field_id,"gmv");
 }finally{view.unmount();}
});
test("filter additions respect date-only tables, snapshot exclusions and the condition limit",()=>{
 const pkg=fixture("A");const props={pkg,filters:model.exports.defaultFilters(pkg),onChange:next=>props.filters=next};
 const view=mount("query-filters.tsx","QueryFilters",props);
 try{
  pkg.fields=pkg.fields.slice(0,1);view.render();assert.equal(view.button("添加条件").props.disabled,true);
  view.button("添加条件").props.onClick();assert.equal(props.filters.length,1);
  pkg.fields=fixture("A").fields;pkg.table.query_config.storage="FULL_SNAPSHOT";props.filters=[];view.render();view.button("添加条件").props.onClick();view.render();assert.equal(props.filters[0].field_id,"gmv");
  const field=view.node(node=>node.props?.["aria-label"]==="筛选字段 1");assert.equal(field.props.disabled,false);assert.ok(!field.props.options.some(option=>option.value==="ds"));
  assert.deepEqual(field.props.groups.map(group=>group.label),["指标","维度","标签"]);assert.ok(field.props.groups.every(group=>group.options.length>0));
  props.filters=Array.from({length:100},()=>({field_id:"gmv",operator:"EQ",values:["1"]}));view.render();assert.equal(view.button("添加条件").props.disabled,true);
 }finally{view.unmount();}
});

test("workbench replaces table, ignores late requests and switches modes without stale fields",async()=>{
 let release;const slow=new Promise(resolve=>release=resolve);const calls=[];
 const api=async(url,options)=>{calls.push([url,options]);if(url==="/semantic/queryable-tables")return {items:[],groups:[]};if(url==="/packages/A")return slow;if(url==="/packages/B")return fixture("B");return {};};
 const view=mount("data-query-workbench.tsx","DataQueryWorkbench",{},api);
 try{
  view.render();await flush();view.render();
  view.node(node=>node.type==="DatasetSelector").props.onChange("A");view.render();view.node(node=>node.type==="DatasetSelector").props.onChange("B");await flush();view.render();
  release(fixture("A"));await flush();view.render();
  assert.equal(view.node(node=>node.type==="QueryFilters").props.pkg.table.id,"B");
  view.node(node=>node.type==="QueryFilters").props.onChange([...model.exports.defaultFilters(fixture("B")),{field_id:"gmv",operator:"GT",values:["100"]},{field_id:"label",operator:"EQ",values:["旗舰"],logic:"OR"}]);view.render();assert.equal(view.node(node=>node.type==="QueryFilters").props.filters[2].logic,"OR");
  assert.ok(view.node(node=>node.type==="Card"));
  assert.ok(view.node(node=>node.type==="EmptyState"&&node.props.title==="等待查询结果"));
  const fieldRows=nodes(view.render()).filter(node=>node.type==="label"&&node.props.children?.[0]?.type==="Checkbox");assert.equal(fieldRows.length,5);
  for(const row of fieldRows){
   assert.match(row.props.className,/min-h-6/);assert.match(row.props.className,/gap-2/);assert.match(row.props.className,/py-1\.5/);assert.doesNotMatch(row.props.className,/py-2\.5|my-0\.5/);
   assert.equal(row.props.children[0].type,"Checkbox");assert.match(row.props.children[1].props.className,/flex-1 truncate/);assert.match(row.props.children[2].props.className,/text-right/);
  }
  const salesRow=fieldRows.find(row=>row.props.children[1].props.children==="销售额");assert.match(text(salesRow.props.children[2]),/gmv/);
  view.node(node=>node.type==="Checkbox"&&!node.props.disabled).props.onCheckedChange();view.render();
  const mode=()=>view.node(node=>node.type==="Switch");
  const modeText=()=>text(view.node(node=>node.type==="label"&&node.props.htmlFor==="data-query-mode"));
  const modeHelp=()=>text(view.node(node=>node.type==="TooltipContent"));
  assert.equal(mode().props.checked,false);assert.equal(mode().props.disabled,false);assert.equal(modeText(),"明细查询");assert.equal(mode().props["aria-label"],"明细查询");
  assert.equal(view.node(node=>node.type==="Combobox"&&node.props["aria-label"]==="查询模式"),undefined);
  assert.match(modeHelp(),/明细查询：返回原始数据/);assert.doesNotMatch(modeHelp(),/开启|关闭/);
  mode().props.onCheckedChange(true);view.render();assert.equal(mode().props.checked,true);assert.equal(modeText(),"汇总查询");assert.equal(mode().props["aria-label"],"汇总查询");assert.match(modeHelp(),/汇总查询：按治理指标口径/);assert.ok(view.node(node=>node.type==="Checkbox"&&node.props.disabled));
  mode().props.onCheckedChange(false);view.render();assert.equal(mode().props.checked,false);assert.equal(modeText(),"明细查询");assert.match(modeHelp(),/明细查询：返回原始数据/);
  assert.ok(calls.find(([url,options])=>url==="/packages/A"&&options.signal.aborted));
  view.node(node=>node.type==="DatasetSelector").props.onChange("B");view.render();assert.ok(view.node(node=>node.type==="Dialog"&&node.props.open));view.button("放弃修改").props.onClick();await flush();view.render();assert.deepEqual(view.node(node=>node.type==="QueryFilters").props.filters,model.exports.defaultFilters(fixture("B")));
 }finally{view.unmount();}
});
test("detail Switch clears incompatible fields and sorting, and restores the saved query mode",async()=>{
 const task={id:"saved",table_id:"A",status:"CANCELLED",expires_at:new Date(Date.now()+86400000).toISOString(),request:{mode:"AGGREGATE",field_ids:["formula","shop"],filters:[{field_id:"ds",preset:"YESTERDAY"},{field_id:"shop",operator:"EQ",values:["A"]},{field_id:"gmv",operator:"GT",values:["100"],logic:"OR"}],order_by:[{field_id:"formula",direction:"DESC"}]},row_count:0,resolved_dates:[],content_version:"v1"};
 const api=async url=>url==="/semantic/queryable-tables"?{items:[],groups:[]}:url==="/packages/A"?fixture("A"):url==="/data-queries/saved"?task:{};
 const view=mount("data-query-workbench.tsx","DataQueryWorkbench",{},api);
 const mode=()=>view.node(node=>node.type==="Switch");
 const field=name=>view.node(node=>node.type==="Checkbox"&&node.props["aria-label"]===name);
 const sort=()=>view.node(node=>node.type==="Combobox"&&node.props["aria-label"]==="排序字段");
 try{
  view.window.location.href="http://localhost/query/data?queryId=saved";
  view.render();assert.equal(mode().props.disabled,true);await flush();view.render();
  assert.equal(view.node(node=>node.type==="QueryFilters").props.filters[2].logic,"OR");
  assert.equal(mode().props.checked,true);assert.equal(mode().props["aria-label"],"汇总查询");assert.equal(field("计算指标").props.checked,true);assert.equal(sort().props.value,"formula");
  mode().props.onCheckedChange(false);view.render();assert.equal(mode().props.checked,false);assert.equal(mode().props["aria-label"],"明细查询");assert.equal(field("计算指标").props.checked,false);assert.equal(field("计算指标").props.disabled,true);assert.equal(field("店铺").props.checked,true);assert.equal(sort().props.value,"");
  field("统计日期").props.onCheckedChange();view.render();sort().props.onValueChange("ds");view.render();
  mode().props.onCheckedChange(true);view.render();assert.equal(field("统计日期").props.checked,false);assert.equal(field("统计日期").props.disabled,true);assert.equal(field("店铺").props.checked,true);assert.equal(sort().props.value,"");
 }finally{view.unmount();}
});

test("query results use shared tables, preserve exact values and keep results on unchanged pagination",async()=>{
 const calls=[];
 const task={id:"task",table_id:"A",status:"SUCCEEDED",expires_at:new Date(Date.now()+86400000).toISOString(),request:{mode:"DETAIL",field_ids:["gmv"],filters:[]},row_count:201,elapsed_ms:1200,content_version:"v1",resolved_dates:[{field_id:"ds",start:"2026-10-09",end:"2026-10-09"}],sql:"SELECT gmv"};
 const api=async(url,options)=>{
  calls.push([url,options]);
  if(url==="/semantic/queryable-tables")return {items:[],groups:[]};
  if(url==="/packages/A")return fixture("A");
  if(url==="/data-queries")return task;
  if(url.includes("/result?")){
   const params=new URL(url,"http://localhost").searchParams;
   return {columns:[{name:"销售额",type:"DECIMAL"},{name:"店铺名称",type:"STRING"}],rows:[["12345678901234567890.123456","香影官方旗舰店-日常"],[null,"ELLE女装艾世天猫outlet店-日常"]],page:Number(params.get("page")),page_size:Number(params.get("pageSize")),total:201,total_pages:3};
  }
  throw new Error("Unexpected API "+url);
 };
 const view=mount("data-query-workbench.tsx","DataQueryWorkbench",{},api);
 try{
  view.render();await flush();view.render();
  view.node(node=>node.type==="DatasetSelector").props.onChange("A");await flush();view.render();
  view.node(node=>node.type==="Checkbox"&&node.props["aria-label"]==="销售额").props.onCheckedChange();view.render();
  view.node(node=>node.type==="QueryFilters").props.onChange([...model.exports.defaultFilters(fixture("A")),{field_id:"shop",operator:"EQ",values:["A"]},{field_id:"gmv",operator:"GT",values:["100"],logic:"OR"}]);view.render();
  view.button("查询").props.onClick();await flush();view.render();await flush();let tree=view.render();
  assert.equal(JSON.parse(calls.find(([url])=>url==="/data-queries")[1].body).filters[2].logic,"OR");
  assert.ok(view.node(node=>node.type==="Table"));assert.match(text(tree),/12345678901234567890\.123456/);assert.match(text(tree),/NULL/);assert.match(text(tree),/香影官方旗舰店-日常/);assert.match(text(tree),/ELLE女装艾世天猫outlet店-日常/);assert.doesNotMatch(text(tree),/\uFFFD/);
  const metadata=view.node(node=>node.props?.["aria-live"]==="polite");const statusRow=metadata.props.children[0];assert.match(statusRow.props.className,/flex flex-wrap/);
  const dates=statusRow.props.children.at(-1);assert.match(dates.props.className,/ml-auto/);assert.match(text(dates),/实际日期：2026-10-09 至 2026-10-09/);assert.ok(!nodes(metadata).some(node=>node.type==="p"&&text(node).startsWith("实际日期：")));
  const pagination=()=>view.node(node=>node.type==="Pagination");
  pagination().props.onPageChange(1);pagination().props.onPageSizeChange(100);tree=view.render();assert.ok(view.node(node=>node.type==="Table"));
  pagination().props.onPageChange(2);view.render();await flush();view.render();assert.equal(pagination().props.currentPage,2);
  pagination().props.onPageSizeChange(50);view.render();await flush();view.render();assert.equal(pagination().props.currentPage,1);assert.equal(pagination().props.pageSize,50);
  assert.ok(calls.some(([url])=>url.includes("page=2&pageSize=100")));assert.ok(calls.some(([url])=>url.includes("page=1&pageSize=50")));
  assert.match(view.window.location.href,/queryId=task/);
 }finally{view.unmount();}
});

test("shared pagination has compact page numbers, ellipses and disabled boundary controls",()=>{
 const changed=[];
 const props={currentPage:5,totalPages:20,onPageChange:value=>changed.push(value),pageSize:100,onPageSizeChange:value=>changed.push(value),pageSizeOptions:[{value:100,label:"100 行/页"}]};
 const view=mount("../ui/pagination.tsx","Pagination",props);
 try{
  view.render();assert.equal(view.node(node=>node.props?.["aria-current"]==="page").props.children,5);
  assert.equal(view.node(node=>node.type==="Combobox").props.menuPlacement,"top");
  view.node(node=>node.props?.["aria-label"]==="下一页").props.onClick();assert.deepEqual(changed,[6]);
  props.currentPage=1;props.totalPages=0;const tree=view.render();
  assert.equal(view.node(node=>node.props?.["aria-label"]==="上一页").props.disabled,true);
  assert.equal(view.node(node=>node.props?.["aria-label"]==="下一页").props.disabled,true);
  assert.equal(nodes(tree).filter(node=>node.props?.["aria-current"]==="page").length,1);
 }finally{view.unmount();}
});

test("result pagination is server-side, URL recovery and cleanup never cancel tasks",()=>{
 const source=read("data-query-workbench.tsx");
 assert.match(source,/\/result\?page=/);assert.match(source,/pageSize=/);assert.match(source,/queryId/);assert.match(source,/scope\.current\.abort\(\)/);
 assert.doesNotMatch(source,/localStorage|sessionStorage|token/);
 assert.ok(!fs.existsSync(path.join(__dirname,"../app/query/debug/page.tsx")));
});

test("login keeps data-query task URLs and rejects external return locations",()=>{
 const mod={exports:{}};const source=fs.readFileSync(path.join(__dirname,"../lib/login-location.ts"),"utf8");new Function("module","exports",transpile(source))(mod,mod.exports);
 const login=mod.exports.loginLocation({pathname:"/query/data",search:"?queryId=my-task"});
 assert.equal(mod.exports.loginDestination({search:login.slice(login.indexOf("?"))}),"/query/data?queryId=my-task");
 for(const value of ["https://evil.example","//evil.example","/query/data-evil","/query/data\\evil"])assert.equal(mod.exports.loginDestination({search:"?returnTo="+encodeURIComponent(value)}),"/");
});
