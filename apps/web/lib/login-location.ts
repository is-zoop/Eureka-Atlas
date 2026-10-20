// Restore only explicitly supported internal workflows and their identifying parameter.
function returnPath(pathname: string, search: string) {
  const key =
    pathname === "/query/data"
      ? "queryId"
      : pathname === "/integrations/plugins/data-selector"
        ? "session_id"
        : null;
  if (!key) return "/";
  const id = new URLSearchParams(search).get(key);
  return pathname + (id ? "?" + key + "=" + encodeURIComponent(id) : "");
}
export function loginLocation(location: Pick<Location, "pathname" | "search">) {
  const path = returnPath(location.pathname, location.search);
  return path === "/"
    ? "/login"
    : "/login?returnTo=" + encodeURIComponent(path);
}
export function loginDestination(location: Pick<Location, "search">) {
  const value = new URLSearchParams(location.search).get("returnTo");
  if (!value || !value.startsWith("/") || value.includes("\\")) return "/";
  try {
    const url = new URL(value, "http://eureka.local");
    if (url.origin !== "http://eureka.local") return "/";
    return returnPath(url.pathname, url.search);
  } catch {
    return "/";
  }
}
