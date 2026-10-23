const test=require('node:test'),assert=require('node:assert/strict');
const {formatResultCell:f,resolveResultDisplay:r,buildResultPresentation:p,resultColumnLabel:l,convertUnitValue}=require('../dist');
const col=(type='DECIMAL',unit=null,metric=true)=>({name:'值',type,unit,display:r({type,unit,metric})});
test('percentage units alone convert ratios and use two decimal places',()=>{
  assert.equal(f('0.0472781893153730084',col('DECIMAL','%')),'4.73%');
  assert.equal(f('0.159017009969029462',col('DECIMAL','%')),'15.90%');
  assert.equal(f('1.234567',col('DECIMAL','%')),'123.46%');
  assert.equal(f('4.457756',col('DECIMAL','%')),'445.78%');
  assert.equal(f('0.012345',col('DECIMAL','‰')),'12.35‰');
  assert.equal(f('0',col('DECIMAL','%')),'0.00%');
  assert.equal(f(null,col('DECIMAL','%')),'—');
  assert.equal(l(col('DECIMAL','%')),'值（%）');
});
test('amounts and counts use the governed display magnitude rather than changing SQL',()=>{
  assert.equal(f('123456.789',col('DECIMAL','万元')),'12.35');
  assert.equal(f('123456789.123456789',col('DECIMAL','亿元')),'1.23');
  assert.equal(f('25000',col('INTEGER','万元')),'2.50');
  assert.equal(f('12345.678',col('DECIMAL','万人')),'1.23');
  assert.equal(f('-123456.789',col('DECIMAL','万元')),'-12.35');
  assert.equal(f('1234.56',col('DECIMAL','元')),'1234.56');
  assert.equal(l(col('DECIMAL','万元')),'值（万元）');
  assert.equal(convertUnitValue('12345678901234567890.125','万元'),'1234567890123456.7890125');
  assert.equal(convertUnitValue('0.0472781893153730084','%'),'4.72781893153730084');
});
test('rounding preserves raw precision, identifiers, dates, integers and null',()=>{
  assert.equal(f('7.164431',col()),'7.16');assert.equal(f('-0.000001',col()),'0.00');
  assert.equal(f('12345678901234567890.125',col()),'12345678901234567890.13');
  assert.equal(f('12345678901234567890',col('INTEGER')),'12345678901234567890');
  assert.equal(f('000123',col('INTEGER',null,false)),'000123');
  assert.equal(f('2026-10-20',col('DATE',null,false)),'2026-10-20');
  assert.equal(f('NaN',col()),'NaN');assert.equal(f('1e100000',col()),'1e100000');
});
test('presentation is bounded, escaped, unit-driven, and never mutates raw results',()=>{
  const result={columns:[col('DECIMAL','%'),col('DECIMAL','万元')],rows:[['0.0472781893153730084','123456.789']],truncated:false},before=JSON.stringify(result),out=p(result);
  assert.deepEqual(out.rows,[['4.73%','12.35']]);assert.equal(JSON.stringify(result),before);
  assert.doesNotMatch(out.markdown,/原值|未确认|尺度/);
  const many={columns:[col()],rows:Array.from({length:5000},()=>['12.345']),truncated:false};
  assert.equal(p(many).displayed_rows,100);assert.equal(p(many).saved_rows,5000);assert.equal(p(many).truncated,true);
  assert.ok(p({columns:[{name:'a|b',type:'STRING',unit:null}],rows:[['x|y\nz']],truncated:false}).markdown.includes('x\\|y z'));
  assert.ok(p(many,100,128).markdown.length<=128);
});
