const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
test('PostgreSQL serializes scope edits with admission and does not widen stale scopes',{skip:process.env.ATLAS_DATABASE_VERIFY!=='1'},async()=>{
 require('dotenv').config({path:'../../.env',quiet:true});const{prisma}=require('@eureka-atlas/database');const{AgentSessionsService}=require('../dist/integrations/agent-sessions.service');
 const service=new AgentSessionsService({list:async()=>({items:[{id:'verification-table'}]})}),owner='scope-verification-'+randomUUID();let id,unlock;
 try{const row=await service.create(owner);id=row.id;const scope={id,ownerMemberNo:owner,revision:0,tableIds:['verification-table']};let ready;const entered=new Promise(r=>ready=r),gate=new Promise(r=>unlock=r);
 const admission=prisma.$transaction(async tx=>{await service.lockAdmission(tx,scope,'verification-table');ready();await gate;},{timeout:10000});await entered;
 let edited=false;const edit=service.update(owner,id,{scope_mode:'SELECTED',selected_table_ids:['verification-table'],expected_revision:0}).then(()=>edited=true);
 await new Promise(r=>setTimeout(r,100));assert.equal(edited,false,'scope update must wait for admission row lock');unlock();await Promise.all([admission,edit]);
 await assert.rejects(prisma.$transaction(tx=>service.lockAdmission(tx,scope,'verification-table')),e=>e.getResponse().code==='SCOPE_CHANGED');
 assert.equal((await service.describe(owner,id)).scope_revision,1);
 }finally{unlock?.();if(id)await prisma.agentQuerySession.deleteMany({where:{id,ownerMemberNo:owner}});await prisma.$disconnect();}
});
