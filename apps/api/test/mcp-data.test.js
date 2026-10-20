const test=require('node:test'),assert=require('node:assert/strict');
const {prisma}=require('@eureka-atlas/database'),{McpDataService}=require('../dist/integrations/mcp-data.service'),{ExternalContractService}=require('../dist/external-api/external-contract.service');
const {SemanticScopeService}=require('../dist/semantic/semantic-scope.service'),{basePackage,queryBody}=require('./helpers/external-fixture');
test('all seven MCP data tools are documented and scope is enforced before package/query work',async()=>{
 const pkg=basePackage(),calls=[];let ids=['table'];const sessions={resolve:async()=>({id:'s',revision:1,tableIds:ids}),touch:async()=>({})};
 const semantic=new SemanticScopeService({list:async()=>({items:[{id:'table'},{id:'other'}]})},{get:async id=>({...pkg,table:{...pkg.table,id}})});
 const data=new McpDataService(sessions,new ExternalContractService(),{replay:async()=>null,package:async id=>{calls.push(id);return pkg},submit:async(...args)=>{calls.push(args);return{id:'q'}}},semantic);
 const defs=await data.definitions();assert.equal(defs.length,7);for(const d of defs){assert.ok(d.inputSchema.required.includes('session_id'));assert.equal(d.inputSchema.additionalProperties,false)}
 const ctx={session_id:'s',scope_revision:1};const result=await data.call('A','search_semantic_assets',{...ctx,keywords:['销售额']});assert.deepEqual(result.items.map(t=>t.table_id),['table']);
 for(const name of ['get_semantic_package','query_data','get_dimension_values'])await assert.rejects(data.call('A',name,{...ctx,...(name==='query_data'?queryBody():name==='get_dimension_values'?{field_id:'shop',content_version:'v1',idempotency_key:'x'}:{}),table_id:'other'}),e=>e.getStatus()===404);
 assert.equal(calls.length,0);await data.call('A','get_semantic_package',{...ctx,table_id:'table'});assert.equal(calls.length,1);
 ids=[];assert.equal((await data.call('A','search_semantic_assets',{...ctx,keywords:['销售额']})).total,0);
 await assert.rejects(data.call('A','query_data',{...queryBody(),session_id:'s'}),e=>e.getStatus()===400);
});
test('MCP task reads/cancel cannot borrow ordinary REST or another conversation tasks',async()=>{const original=prisma.queryExecution.findUnique;try{const data=new McpDataService({touch:async()=>({})},new ExternalContractService(),{status:async()=>({status:'SUCCEEDED'}),cancel:async()=>({status:'CANCELLED'})},{});
 for(const owner of ['A','B'])for(const session of [null,'other','s']){prisma.queryExecution.findUnique=async()=>({id:'q',ownerMemberNo:owner,agentQuerySessionId:session,kind:'SEMANTIC_QUERY'});if(owner==='A'&&session==='s')assert.equal((await data.call('A','get_query_status',{session_id:'s',query_id:'q'})).status,'SUCCEEDED');else for(const tool of ['get_query_status','get_query_result','cancel_query'])await assert.rejects(data.call('A',tool,{session_id:'s',query_id:'q'}),e=>e.getStatus()===404);}
}finally{prisma.queryExecution.findUnique=original}});
