import { getApplication } from "./lib/host.ts";
import { createPaneController } from "./lib/taskpane.ts";
import { overwriteEnabled, toggleOverwrite, requestUpdateAll } from './lib/ribbon-state.ts';

const openPane = createPaneController();
window.AtlasOnLoad = () => true;
window.AtlasOpenPane = () => {
  try {
    openPane(getApplication(), new URL("./", window.location.href).href);
    return true;
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "无法打开 Atlas 助手，请重新启动 WPS 后重试。");
    return false;
  }
};
window.AtlasGetImage = (control) => ({ AtlasOpenPane: 'images/atlas.png', AtlasUpdateAll: 'images/refresh-cw.png', AtlasAbout: 'images/info.png' })[control.Id as 'AtlasOpenPane' | 'AtlasUpdateAll' | 'AtlasAbout'];
window.AtlasGetOverwrite = () => overwriteEnabled(getApplication());
// WPS's native checkbox argument order is not the Office callback contract.
// A click toggles the canonical shared state; callback objects never enter storage.
window.AtlasSetOverwrite = () => { try { toggleOverwrite(getApplication()); return true; } catch (error) { window.alert(String(error)); return false; } };
window.AtlasUpdateAll = () => {
  try { requestUpdateAll(getApplication()); return window.AtlasOpenPane(); }
  catch (error) { window.alert(error instanceof Error ? error.message : '无法开始全部更新'); return false; }
};
window.AtlasAbout = () => {
  window.alert("Atlas WPS 数据助手\n\n登录 Atlas → 选择我的查询 → 查询／刷新工作表\n\n全部更新：逐个更新当前工作簿中属于当前账号的已绑定查询。\n刷新覆盖：勾选后刷新不再询问覆盖范围，请勿在结果范围内维护手工数据。\n\n关闭助手保留有效登录态和后台任务。写入后请手动保存工作簿。");
  return true;
};
