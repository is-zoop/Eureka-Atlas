const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('node:path'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const format=require('@eureka-atlas/result-format');
function load(file,overrides){const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../'+file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('module','exports','require',code)(m,m.exports,n=>n in overrides?overrides[n]:require(n));return m.exports;}
test('web result and MCP presentation apply existing percentage and monetary units identically',()=>{
 const{QueryResult}=load('components/ask/query-result.tsx',{'@/components/ui/button':{Button:()=>null},'@/components/ui/table':{Table:({children})=>React.createElement('table',null,children)},'./query-visualization':{QueryVisualization:({children})=>children}});
 const columns=[{name:'加购率',type:'DECIMAL',unit:'%'},{name:'销售额',type:'DECIMAL',unit:'万元'},{name:'编号',type:'INTEGER',unit:null,display:format.resolveResultDisplay({type:'INTEGER',metric:false})}],result={columns,rows:[['0.0472781893153730084','123456.789','000123'],[null,null,'12345678901234567890']],truncated:false};
 const before=JSON.stringify(result),saved={execution:{result,elapsed_ms:0},source:{business_name:'表',physical_name:'facts'},query_definition:{}};
 const html=renderToStaticMarkup(React.createElement(QueryResult,{saved,status:'SUCCEEDED',onRefresh(){},onDownload(){}}));
 for(const value of format.buildResultPresentation(result).rows.flat())assert.ok(html.includes(value),value);
 assert.ok(html.includes('加购率（%）'));assert.ok(html.includes('销售额（万元）'));assert.ok(html.includes('4.73%'));assert.ok(html.includes('12.35'));
 assert.doesNotMatch(html,/0\.0472781893153730084|尺度未确认|默认精度/);assert.equal(JSON.stringify(result),before);
});
test('governance restores the original unit-only UI with no precision or scale controls',()=>{
 assert.equal(fs.existsSync(path.join(__dirname,'../components/governance/metric-display-editor.tsx')),false);
 for(const file of ['components/governance/calculated-metrics.tsx','app/governance/tables/[tableId]/page.tsx']){
  const source=fs.readFileSync(path.join(__dirname,'../'+file),'utf8');assert.doesNotMatch(source,/MetricDisplayEditor|displayFormat|默认精度|百分比原值尺度/);
 }
});
test('charts convert axis values and exact hover values using the same unit without altering saved data',()=>{
 const {chartData}=load('components/ask/chart-data.ts',{}),result={columns:[{name:'日期',type:'STRING',unit:null},{name:'金额',type:'DECIMAL',unit:'万元'}],rows:[['20261020','123456.789']],truncated:false},before=JSON.stringify(result);
 const data=chartData(result,{type:'bar',x_column:0,y_columns:[1],title:'金额'});
 assert.equal(data.unit,'万元');assert.equal(data.points[0].values[0],12.3456789);assert.equal(data.points[0].raw[0],'12.3456789');assert.equal(JSON.stringify(result),before);
});
