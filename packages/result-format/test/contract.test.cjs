const test=require('node:test'),assert=require('node:assert/strict');
const {resolveResultDisplay:r,unitScalePower}=require('../dist');
test('display is computed from existing units and query roles without maintained format fields',()=>{
  assert.deepEqual(r({type:'DECIMAL',metric:true,unit:'%'}),{style:'NUMBER',decimal_places:2});
  assert.deepEqual(r({type:'INTEGER',metric:false}),{style:'TEXT',decimal_places:0});
  assert.equal(r({type:'DECIMAL',metric:true}).decimal_places,2);
  assert.equal(r({type:'INTEGER',metric:true}).decimal_places,0);
  assert.equal(r({type:'INTEGER',metric:true,aggregation:'AVG'}).decimal_places,2);
  assert.equal(r({type:'DECIMAL',metric:true,aggregation:'COUNT'}).decimal_places,0);
  assert.equal(r({type:'INTEGER',metric:true,unit:'万元'}).decimal_places,2);
});
test('unit magnitudes are deterministic, with ordinary and physical units left unchanged',()=>{
  for(const[u,p]of[['%',2],['％',2],['百分比',2],['‰',3],['千分比',3],['万元',-4],['万人',-4],['万件',-4],['亿元',-8],['万亿元',-12],['百万美元',-6],['千万元',-7],['十亿元',-9],['千元',-3],['百元',-2],['元',0],['人',0],['千克',0],['千瓦',0],['倍',0],['',0],[null,0]])assert.equal(unitScalePower(u),p,String(u));
});
