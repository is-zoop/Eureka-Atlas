import { ServiceUnavailableException } from "@nestjs/common";
import { BlockList, isIP } from "node:net";

const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  privateAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  privateAddresses.addSubnet(address, prefix, "ipv6");

function internalHostname(hostname: string) {
  const host = hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  const family = isIP(host);
  if (family)
    return privateAddresses.check(host, family === 4 ? "ipv4" : "ipv6");
  return (
    !host.includes(".") ||
    /\.(localhost|local|localdomain|internal)$/.test(host)
  );
}
export function integrationOrigin() {
  const configured =
    process.env.WEB_ORIGIN?.split(",")[0]?.trim() ||
    (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  try {
    const url = new URL(configured);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (process.env.NODE_ENV === "production" &&
        internalHostname(url.hostname)) ||
      !(
        url.protocol === "https:" ||
        (process.env.NODE_ENV !== "production" &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      )
    )
      throw Error();
    return url.origin;
  } catch {
    throw new ServiceUnavailableException(
      "请为集成中心配置可信的 HTTPS WEB_ORIGIN，不能使用内网服务地址或请求 Host。",
    );
  }
}
export const selectorUrl = (id?: string) =>
  integrationOrigin() +
  "/integrations/plugins/data-selector" +
  (id ? "?session_id=" + encodeURIComponent(id) : "");
