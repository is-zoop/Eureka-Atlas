import { BadGatewayException, Injectable, ServiceUnavailableException } from "@nestjs/common";

@Injectable()
export class LlmService {
  async complete(prompt: string, signal?: AbortSignal): Promise<string> {
    const baseUrl = process.env.LLM_BASE_URL?.replace(/\/$/, ""); const apiKey = process.env.LLM_API_KEY; const model = process.env.LLM_MODEL;
    if (!baseUrl || !apiKey || !model) throw new ServiceUnavailableException("LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must be configured");
    let response: Response;
    const timeout = AbortSignal.timeout(60_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try { response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", signal: requestSignal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature: 0.2, thinking: { type: "disabled" }, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }) }); } catch { if (signal?.aborted) throw new Error("AI generation cancelled"); throw new BadGatewayException("LLM request failed or timed out after 60 seconds"); }
    const rawBody = await response.text();
    if (!rawBody.trim()) throw new BadGatewayException(`LLM returned an empty response body (HTTP ${response.status})`);
    let body: Record<string, unknown>;
    try { body = JSON.parse(rawBody) as Record<string, unknown>; } catch { throw new BadGatewayException(`LLM returned a non-JSON response (HTTP ${response.status})`); }
    const error = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : undefined;
    const errorMessage = typeof error?.message === "string" ? error.message : "";
    if (!response.ok) throw new BadGatewayException(`LLM returned HTTP ${response.status}${errorMessage ? `: ${errorMessage}` : ""}`);
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>).message : undefined;
    const content = message && typeof message === "object" ? (message as Record<string, unknown>).content : undefined;
    if (typeof content !== "string" || !content.trim()) { const detail = errorMessage ? `: ${errorMessage}` : ` (received: ${Object.keys(body).join(", ") || "empty response"})`; throw new BadGatewayException(`LLM response does not contain message content${detail}`); }
    return content;
  }
}
