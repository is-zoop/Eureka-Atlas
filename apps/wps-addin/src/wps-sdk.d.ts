declare module "wpsjs-rpc-sdk-new" {
  const sdk: { WpsAddonMgr: import("./lib/installer.ts").AddonManager };
  export default sdk;
}
