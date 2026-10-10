
require("dotenv").config({path:require("node:path").resolve(__dirname,"../../../.env")});
const assert = require("node:assert/strict");
const test = require("node:test");
const { prisma } = require("@eureka-atlas/database");
const { AskRunService } = require("../dist/ask/ask-run.service");
const { AskEventService } = require("../dist/ask/ask-event.service");

test("database persists model snapshots and processing summaries without altering model configuration", async () => {
  const memberNo = "integration-" + crypto.randomUUID();
  let session; let provider;
  try {
    const model = await prisma.modelConfig.findFirst({select:{id:true,displayName:true,modelId:true,provider:{select:{name:true}}}});
    assert.ok(model, "需要至少一个已配置模型");
    session = await prisma.askSession.create({data:{ownerMemberNo:memberNo,title:"[自动验收] 问数结果样式",modelConfigId:model.id,tableIds:[]}});
    const displayName = model.displayName || model.modelId;
    const run = await prisma.askRun.create({data:{askSessionId:session.id,idempotencyKey:crypto.randomUUID(),question:"样式验收，不执行 SQL",status:"SUCCEEDED",answer:"最终回答",modelConfigId:model.id,modelDisplayName:displayName,modelProviderName:model.provider.name,tableIds:[],completedAt:new Date()}});
    const events = new AskEventService();
    const original = {id:"tool-1",message_id:"assistant",tool_call_id:"tool-1",kind:"tool",name:"搜索资产",status:"RUNNING",summary:"正在处理",started_at:new Date().toISOString(),completed_at:null,elapsed_ms:null};
    await events.publish(run.id,"processing",{step:original});
    await events.publish(run.id,"progress",{query_id:"fixture-only",status:"RUNNING"});
    await events.publish(run.id,"processing",{step:{...original,status:"SUCCEEDED",summary:"发现 1 张候选表",elapsed_ms:100,completed_at:new Date().toISOString()}});
    const service = new AskRunService({}, {}, {}, events);
    const result = await service.detail(memberNo, run.id);
    assert.equal(result.model_display_name,displayName);
    assert.equal(result.model_provider_name,model.provider.name);
    assert.equal(result.processing.tool_count,1);
    assert.equal(result.processing.steps[0].elapsed_ms,100);
    assert.equal(result.answer,"最终回答");
    assert.equal(result.event_cursor,3);
    const old = await prisma.askRun.create({data:{askSessionId:session.id,idempotencyKey:crypto.randomUUID(),question:"未记录模型名称",status:"SUCCEEDED",answer:"历史回答",modelConfigId:model.id,tableIds:[],completedAt:new Date()}});
    assert.equal((await service.detail(memberNo, old.id)).model_display_name,null);
    provider = await prisma.modelProvider.create({data:{name:"[自动验收] "+crypto.randomUUID(),kind:"CUSTOM",protocol:"openai-completions"}});
    const temporaryModel=await prisma.modelConfig.create({data:{providerId:provider.id,modelId:"fixture",displayName:"模型原名",protocol:"openai-completions"}});
    const snapshotRun=await prisma.askRun.create({data:{askSessionId:session.id,idempotencyKey:crypto.randomUUID(),question:"模型名称快照验收",status:"SUCCEEDED",modelConfigId:temporaryModel.id,modelDisplayName:"模型原名",modelProviderName:provider.name,tableIds:[],completedAt:new Date()}});
    await prisma.modelConfig.update({where:{id:temporaryModel.id},data:{displayName:"模型改名"}});
    await prisma.modelProvider.update({where:{id:provider.id},data:{name:"[已改名] "+crypto.randomUUID()}});
    assert.equal((await service.detail(memberNo, snapshotRun.id)).model_display_name,"模型原名");
    await prisma.modelProvider.delete({where:{id:provider.id}});
    const preserved=await service.detail(memberNo, snapshotRun.id);
    assert.equal(preserved.model_display_name,"模型原名");
    assert.equal(preserved.model_provider_name,provider.name);
    const unchanged=await prisma.modelConfig.findUnique({where:{id:model.id},select:{displayName:true}});
    assert.equal(unchanged.displayName,model.displayName);
  } finally {
    if(session) await prisma.askSession.delete({where:{id:session.id}});
    if(provider) await prisma.modelProvider.deleteMany({where:{id:provider.id}});
    await prisma.$disconnect();
  }
});
