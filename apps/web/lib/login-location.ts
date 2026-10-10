// Only data-query task links are restored; no arbitrary external return URL.
export function loginLocation(location: Pick<Location,"pathname"|"search">) {
  if(location.pathname !== "/query/data")return "/login";
  const id = new URLSearchParams(location.search).get("queryId");
  const path = "/query/data"+(id ? "?queryId="+encodeURIComponent(id) : "");
  return "/login?returnTo="+encodeURIComponent(path);
}
export function loginDestination(location: Pick<Location,"search">) {
  const value = new URLSearchParams(location.search).get("returnTo");
  if(!value || !value.startsWith("/query/data") || value.includes("\\"))return "/";
  const url = new URL(value,"http://eureka.local");
  if(url.origin !== "http://eureka.local" || url.pathname !== "/query/data")return "/";
  const id = url.searchParams.get("queryId");
  return "/query/data"+(id ? "?queryId="+encodeURIComponent(id) : "");
}
