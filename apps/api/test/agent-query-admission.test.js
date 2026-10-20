const test=require('node:test'),assert=require('node:assert/strict');
const {prisma}=require('@eureka-atlas/database');const {createExternalFixture,queryBody}=require('./helpers/external-fixture');
const {ExternalDataService}=require('../dist/external-api/external-data.service');
test('plugin admission binds tasks atomically, preserves original replay and rejects cross-context keys',async()=>{
 const f=await createExternalFixture(),original=prisma.$transaction;let revision=1,checked=0;
 prisma.$transaction=async fn=>fn(prisma);
 const admission=(sessionId,expected)=>({sessionId,revision:expected,check:async()=>{checked++;if(expected!==revision)throw new (require('@nestjs/common').ConflictException)({code:'SCOPE_CHANGED'})}});
 try{const external=f.app.get(ExternalDataService),body=queryBody('bound');const task=await external.submit('A',body,false,admission('s1',1));assert.equal(f.rows.get(task.id).agentQuerySessionId,'s1');assert.equal(f.rows.get(task.id).agentScopeRevision,1);assert.equal(checked,1);assert.equal(f.submissions(),1);
 revision=2;assert.equal((await external.replay('A',body,false,'s1')).id,task.id);assert.equal((await external.submit('A',body,false,admission('s1',1))).id,task.id);assert.equal(f.submissions(),1);
 await assert.rejects(external.replay('A',body,false,'s2'),e=>e.getStatus()===409);
 await assert.rejects(external.submit('A',queryBody('new'),false,admission('s1',1)),e=>e.getResponse().code==='SCOPE_CHANGED');assert.equal(f.rows.size,1);assert.equal(f.submissions(),1);
 const ordinary=await external.submit('A',queryBody('rest'));await assert.rejects(external.replay('A',queryBody('rest'),false,'s1'),e=>e.getStatus()===409);assert.equal(f.rows.get(ordinary.id).agentQuerySessionId,undefined);
 }finally{prisma.$transaction=original;await f.close()}
});
