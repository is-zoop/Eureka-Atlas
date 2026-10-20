const test=require('node:test'),assert=require('node:assert/strict');
const {prisma}=require('@eureka-atlas/database');
const {AgentSessionsService}=require('../dist/integrations/agent-sessions.service');
function fixture(){const rows=new Map(),original={};let published=['a','b'];for(const name of ['create','findFirst','updateMany'])original[name]=prisma.agentQuerySession[name];
 prisma.agentQuerySession.create=async({data})=>{const row={scopeMode:'ALL',selectedTableIds:[],revision:0,...data};rows.set(row.id,row);return row};
 prisma.agentQuerySession.findFirst=async({where})=>{const row=rows.get(where.id);return row?.ownerMemberNo===where.ownerMemberNo?{...row}:null};
 prisma.agentQuerySession.updateMany=async({where,data})=>{const row=rows.get(where.id);if(!row||row.ownerMemberNo!==where.ownerMemberNo||where.revision!==undefined&&where.revision!==row.revision)return{count:0};Object.assign(row,{...data,...(data.revision?{revision:row.revision+1}:{})});return{count:1}};
 const service=new AgentSessionsService({list:async()=>({items:published.map(id=>({id})),groups:[]})});return{service,rows,publish:ids=>published=ids,close:()=>Object.assign(prisma.agentQuerySession,original)};
}
test('agent scopes default to dynamic ALL, selected scopes stay independent, saved scopes persist without a login deadline and corruption fails closed',async()=>{const f=fixture();try{const a=await f.service.create('A'),b=await f.service.create('A');assert.deepEqual((await f.service.resolve('A',a.id,0)).tableIds,['a','b']);
 await f.service.update('A',a.id,{scope_mode:'SELECTED',selected_table_ids:['a'],expected_revision:0});assert.deepEqual((await f.service.resolve('A',a.id,1)).tableIds,['a']);assert.deepEqual((await f.service.resolve('A',b.id,0)).tableIds,['a','b']);
 await assert.rejects(f.service.owned('B',a.id),e=>e.getStatus()===404);await assert.rejects(f.service.resolve('A',a.id,0),e=>e.getStatus()===409);
 f.publish(['b','c']);await assert.rejects(f.service.resolve('A',a.id,1),e=>e.getResponse().code==='SCOPE_INVALID');assert.deepEqual((await f.service.resolve('A',b.id,0)).tableIds,['b','c']);assert.deepEqual((await f.service.describe('A',a.id)).invalid_table_ids,['a']);
 f.rows.get(a.id).selectedTableIds=[];await assert.rejects(f.service.resolve('A',a.id),e=>e.getStatus()===409);assert.equal(f.rows.get(b.id).expiresAt,undefined);assert.equal((await f.service.owned('A',b.id)).id,b.id);
}finally{f.close()}});
test('selection revisions are optimistic, ALL reset is explicit, and empty SELECTED is never expanded',async()=>{const f=fixture();try{const a=await f.service.create('A');for(const body of [{scope_mode:'SELECTED',selected_table_ids:[],expected_revision:0},{scope_mode:'ALL',selected_table_ids:['a'],expected_revision:0},{scope_mode:'ALL',selected_table_ids:[],expected_revision:0,owner:'B'}])await assert.rejects(f.service.update('A',a.id,body),e=>e.getStatus()===400);
 const input={scope_mode:'SELECTED',selected_table_ids:['a'],expected_revision:0};await f.service.update('A',a.id,input);await assert.rejects(f.service.update('A',a.id,input),e=>e.getStatus()===409);
 await f.service.update('A',a.id,{scope_mode:'ALL',selected_table_ids:[],expected_revision:1});assert.deepEqual((await f.service.resolve('A',a.id,2)).tableIds,['a','b']);
}finally{f.close()}});
