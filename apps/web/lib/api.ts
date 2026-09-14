// Keep browser requests on the current origin. Next.js proxies them to the API
// server, so LAN clients never resolve `localhost` to their own machine.
const API_BASE_URL = "/api";
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers: { "Content-Type": "application/json", ...options?.headers }, cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.message ?? `Request failed (${response.status})`);
    Object.assign(error, body);
    throw error;
  }
  const body = await response.text();
  return (body ? JSON.parse(body) : null) as T;
}
