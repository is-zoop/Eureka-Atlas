export interface AddonConfig {
  name: string;
  addonType: "et";
  online: "true";
  url: string;
  version: string;
}

export interface SdkResult { status: number; response?: string; message?: string; msg?: string }
type Callback = (result: SdkResult) => void;

export interface AddonManager {
  getAllConfig(callback: Callback): void;
  verifyStatus(addon: AddonConfig, callback: Callback): void;
  enable(addon: AddonConfig, callback: Callback): void;
  disable(addon: AddonConfig, callback: Callback): void;
}

export function addonConfig(pageUrl: string): AddonConfig {
  return { name: "AtlasWpsProbe", addonType: "et", online: "true", version: "0.4.1", url: new URL("./", pageUrl).href };
}

async function sdkCall(action: (callback: Callback) => void): Promise<SdkResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WPS 未及时返回结果。请检查浏览器的 WPS 启动／本地网络授权；若已点击安装，先重启 WPS 确认是否生效。")), 30_000);
    try {
      action((result) => {
        clearTimeout(timer);
        if (result.status === 0) resolve(result);
        else reject(new Error(result.message || result.msg || "WPS 加载项操作失败，请确认当前安装包支持 JS 加载项。"));
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

export async function manageAddon(manager: AddonManager, config: AddonConfig, action: "install" | "uninstall") {
  // Initializes the native relay version; no changes to other add-ins.
  await sdkCall((callback) => manager.getAllConfig(callback));
  if (action === "install") await sdkCall((callback) => manager.verifyStatus(config, callback));
  const result = await sdkCall((callback) => manager[action === "install" ? "enable" : "disable"](config, callback));
  if (result.response !== "OK" && result.response !== "") {
    throw new Error("WPS 未确认配置成功，请重启 WPS 检查 Atlas 菜单，或重试当前操作。");
  }
}
