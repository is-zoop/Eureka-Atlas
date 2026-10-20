// Native Claude Code Mods module. No Node APIs, browser credential injection or model calls.
export function claudeMenuModule(origin: string) {
  return "const ORIGIN = " + JSON.stringify(origin) + ";\n" + String.raw`
const PREFIX = 'mcp__plugin_atlas-ask_atlas__';
const DATA_TOOLS = ['search_semantic_assets','get_semantic_package','get_dimension_values','query_data','get_query_status','get_query_result','cancel_query','get_query_session','open_selection_menu'];
const ATLAS_TOOLS = ['mcp__plugin_atlas-ask_atlas__create_query_session','mcp__plugin_atlas-ask_atlas__get_query_session','mcp__plugin_atlas-ask_atlas__open_selection_menu','mcp__plugin_atlas-ask_atlas__search_semantic_assets','mcp__plugin_atlas-ask_atlas__get_semantic_package','mcp__plugin_atlas-ask_atlas__get_dimension_values','mcp__plugin_atlas-ask_atlas__query_data','mcp__plugin_atlas-ask_atlas__get_query_status','mcp__plugin_atlas-ask_atlas__get_query_result','mcp__plugin_atlas-ask_atlas__cancel_query'];
const contexts = new Map();
async function fingerprint(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join(''); }
async function identity($) {
  const key = await $.env.get('ATLAS_PERSONAL_CREDENTIAL');
  if(typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(key)) throw new Error('请在本机配置 ATLAS_PERSONAL_CREDENTIAL，然后重新连接插件；不要把凭证发给 AI。');
  return {key,digest:await fingerprint(key)};
}
async function request($, path, method, body) {
  const auth=await identity($);
  const response=await $.http.fetch(ORIGIN+'/api/integrations/selection-native'+path,{method:method||'GET',headers:{Authorization:'Bearer '+auth.key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok) {
    if(response.status===401||response.status===403)throw new Error('当前个人凭证已失效或无权限，请在客户端更新；不会切换到网页登录。');
    if(response.status===409)throw new Error('范围已改变，请重新读取后确认，不会覆盖其他修改。');
    if(response.status===429)throw new Error('请求过于频繁，请稍后再试。');
    throw new Error('选数服务暂时不可用，请重试；已保存的范围不会清空。');
  }
  return JSON.parse(response.text);
}
async function context($, reload) {
  const id=await $.session.id(), auth=await identity($);
  let ctx=contexts.get(id);
  if(!ctx||ctx.digest!==auth.digest){ctx={digest:auth.digest,data:null,selected:[],search:'',error:'',message:'',busy:false,confirm:false};contexts.set(id,ctx);}
  if(!ctx.data||reload){const data=await request($,'/open','POST',{conversation_id:id});ctx.data=data;ctx.selected=data.session.selected_table_ids.slice();ctx.error='';ctx.confirm=false;}
  return ctx;
}
function publicScope(data) {
  const {available_tables,...session}=data.session;
  return {...session,tables:session.scope_mode==='ALL'?available_tables:available_tables.filter(t=>session.selected_table_ids.includes(t.id))};
}
async function redraw($) { await $.ui.invalidate('ui.render'); }
async function save($,ctx) {
  if(ctx.busy)return;
  ctx.busy=true;ctx.error='';ctx.message='';ctx.confirm=false;await redraw($);
  try{if((await identity($)).digest!==ctx.digest){ctx.data=null;ctx.selected=[];throw new Error('身份已变化');}ctx.data=await request($,'/'+encodeURIComponent(ctx.data.session.session_id),'PATCH',{scope_mode:ctx.selected.length?'SELECTED':'ALL',selected_table_ids:ctx.selected,expected_revision:ctx.data.session.scope_revision});ctx.selected=ctx.data.session.selected_table_ids.slice();ctx.message='已保存，后续查询使用当前范围。';}
  catch{ctx.error='保存失败：凭证或服务可能不可用，或范围已有变化。请重新读取后确认；不会自动扩大范围。';}
  finally{ctx.busy=false;await redraw($);}
}
export function register(on) {
  on('session.start',async($,e,next)=>{await $.command.register({name:'atlas_menu',description:'打开当前对话的 Atlas数据目录',immediate:true});return next(e);});
  on('command.run',{command:'atlas_menu'},async($)=>{
    try{await context($,true);}catch{const id=await $.session.id();contexts.set(id,{data:null,error:'无法读取选数范围。请确认本机个人凭证配置有效，并稍后重试。',selected:[],search:'',busy:false,confirm:false});}
    await $.ui.open({id:'atlas-menu',title:'Atlas数据目录',focus:true,closeOnEscape:true});return {};
  });
  on('tool.call',{tool:ATLAS_TOOLS},async($,e,next)=>{
    if(typeof e.tool!=='string'||!e.tool.startsWith(PREFIX))return next(e);
    const name=e.tool.slice(PREFIX.length);
    if(name!=='create_query_session'&&!DATA_TOOLS.includes(name))return next(e);
    let ctx;try{ctx=await context($,false);}catch{return {deny:'Atlas 当前凭证或选数服务不可用，请用户在本机确认，不能新建全范围绕过。'};}
    if(name==='create_query_session')return {result:JSON.stringify({data:publicScope(ctx.data)})};
    if(e.session_id!==ctx.data.session.session_id)return {deny:'只能使用本对话的 Atlas session_id '+ctx.data.session.session_id+'；请读取当前范围，不能切换其他对话。'};
    if(name==='open_selection_menu'){const placed=await $.ui.open({id:'atlas-menu',title:'Atlas数据目录',focus:true,closeOnEscape:true});if(!placed.isPlaced)return {deny:'当前宿主尚未放置原生选数面板，请直接运行 /atlas_menu，不会用网页冒充侧栏。'};return {result:JSON.stringify({data:{session_id:ctx.data.session.session_id,native_pane_opened:true}})};}
    return next(e);
  }).catch(async()=>({deny:'Atlas 对话隔离校验失败，已阻止调用。不要新建全范围绕过；如请求已提交，请读取原任务状态或以原幂等标识确认。'}));
  on('ui.render',{component:'Pane'},async($,e,next)=>{
    if(e.requestId!=='atlas-menu')return next(e);
    const {Box,Text,Button,Input}=$.ui.resolve(e),id=await $.session.id();
    const ctx=contexts.get(id)||{data:null,error:'请运行 /atlas_menu 读取当前对话。',selected:[],search:'',busy:false,confirm:false};
    const reload=async()=>{if(ctx.busy)return;ctx.busy=true;await redraw($);try{const updated=await context($,true);updated.busy=false;updated.message='已读取当前范围。';}catch{const current=contexts.get(id)||ctx;current.busy=false;current.error='读取失败，请确认客户端个人凭证或网络后重试。';}await redraw($);};
    const children=[Text({children:['本面板使用客户端的个人凭证，不进行网页登录。']}),Button({key:'reload',label:'重新读取',onPress:reload})];
    if(ctx.error)children.push(Text({children:[ctx.error]}));
    if(ctx.message)children.push(Text({children:[ctx.message]}));
    if(ctx.data){
      const scope=ctx.data.session;
      children.push(Text({children:['当前用户：'+ctx.data.member_no+' · 范围版本 '+scope.scope_revision]}));
      children.push(Text({children:[ctx.selected.length?'待保存：仅 '+ctx.selected.length+' 张表。':'待保存：全部已发布可查询表（清空不代表禁止查询）。']}));
      if(!scope.scope_valid)children.push(Text({children:['已保存范围失效，新查询被阻止；不会自动扩大范围。']}));
      if(scope.invalid_table_ids.length)children.push(Button({key:'remove-invalid',label:'移除已失效表（'+scope.invalid_table_ids.length+'）',onPress:()=>{if(ctx.busy)return;ctx.selected=ctx.selected.filter(v=>!scope.invalid_table_ids.includes(v));return redraw($);}}));
      children.push(Input({key:'search',label:'搜索数据表',placeholder:'表名或数据域',value:ctx.search,onInput:value=>{ctx.search=value;return redraw($);},onSubmit:value=>{ctx.search=value;return redraw($);}}));
      const term=ctx.search.trim().toLowerCase(),tables=scope.available_tables.filter(t=>[t.business_name,t.physical_name,t.data_domain].some(v=>String(v||'').toLowerCase().includes(term)));
      children.push(Text({children:['匹配 '+tables.length+' 张，显示前 50 张；搜索不改变已选范围。']}));
      for(const table of tables.slice(0,50))children.push(Button({key:'table-'+table.id,label:(ctx.selected.includes(table.id)?'[已选] ':'[未选] ')+String(table.business_name||table.physical_name).slice(0,160),onPress:()=>{if(ctx.busy)return;ctx.selected=ctx.selected.includes(table.id)?ctx.selected.filter(v=>v!==table.id):ctx.selected.concat(table.id);return redraw($);}}));
      children.push(Button({key:'clear',label:'清空勾选（待确认恢复全部）',onPress:()=>{if(ctx.busy)return;ctx.selected=[];return redraw($);}}));
      if(ctx.confirm){children.push(Text({children:['确认恢复全部已发布可查询表？这会扩大当前对话范围。']}));children.push(Button({key:'confirm-all',label:'确认使用全部表',onPress:()=>save($,ctx)}));children.push(Button({key:'back',label:'返回检查',onPress:()=>{ctx.confirm=false;return redraw($);}}));}
      else children.push(Button({key:'save',label:ctx.busy?'处理中…':'保存当前对话范围',onPress:()=>{if(ctx.busy)return;if(!ctx.selected.length&&(scope.scope_mode!=='ALL'||!scope.scope_valid)){ctx.confirm=true;return redraw($);}return save($,ctx);}}));
      children.push(Text({children:['关闭面板不丢失已保存范围；不自动取消后台查询。']}));
    }
    return Box({flexDirection:'column',rowGap:1,children});
  });
}
`;
}
