const test=require('node:test'),assert=require('node:assert/strict');
const {GovernanceWorkspaceService}=require('../dist/governance/governance-workspace.service');
const {buildSemanticPackage}=require('../dist/package/builder/semantic-package.builder');
const {QueryCompilerService}=require('../dist/query/query-compiler.service');
const {buildResultPresentation}=require('@eureka-atlas/result-format');
const now=new Date();
const source=()=>({table:{id:'table',name:'facts',updatedAt:now,metaProject:{name:'dw',updatedAt:now,dataSource:{id:'src',name:'仓库',type:'MAXCOMPUTE',updatedAt:now}},semantic:{id:'s',businessName:'事实',description:'用于单位验证',grain:'rate',queryConfig:{},updatedAt:now},columns:[{id:'r',name:'rate',status:'ACTIVE',normalizedType:'DECIMAL',dataType:'decimal',updatedAt:now,semantic:{id:'cs',metricName:'比率',semanticType:'METRIC',aggregation:'AVG',unit:'%',updatedAt:now,metricCatalogBindings:[]}}],semanticMetrics:[]}});
test('governance and formal Package only require the existing unit, not an extra format config',()=>{
  const s=new GovernanceWorkspaceService({},{}),input={selectedColumns:['r'],columns:[{metaColumnId:'r',metricName:'比率',semanticType:'METRIC',unit:'%',aggregation:'AVG'}]};
  const d=s.normalizeDraft(input,[{id:'r',name:'rate',dataType:'decimal'}],{name:'facts',comment:''});
  assert.equal(d.columns[0].unit,'%');assert.equal('displayFormat' in d.columns[0],false);
  const pkg=buildSemanticPackage(source());assert.equal(pkg.fields[0].unit,'%');assert.equal('display_format' in pkg.fields[0],false);
});
test('changing governed units changes the Package revision and display, never the SQL formula or raw rows',()=>{
  const input=source(),a=buildSemanticPackage(input),compiler=new QueryCompilerService(),request={table_id:'table',metric_ids:['r']};
  const percent=compiler.compileQuery(a,request);const rows=[['0.0472781893153730084']],before=JSON.stringify(rows);
  assert.equal(buildResultPresentation({columns:percent.outputs,rows,truncated:false}).rows[0][0],'4.73%');
  input.table.columns[0].semantic.unit='万元';const b=buildSemanticPackage(input),amount=compiler.compileQuery(b,request);
  assert.notEqual(a.content_version,b.content_version);assert.equal(percent.sql,amount.sql);
  assert.equal(buildResultPresentation({columns:amount.outputs,rows:[['123456.789']],truncated:false}).rows[0][0],'12.35');
  assert.equal(JSON.stringify(rows),before);assert.equal(input.table.columns[0].semantic.aggregation,'AVG');
});
