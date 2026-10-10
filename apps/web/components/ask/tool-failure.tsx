"use client";

export function toolFailureText(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const result = content as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
  if (!result.isError) return null;
  const text = (Array.isArray(result.content) ? result.content : [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text).join("\n");
  // Pi appends the entire input to validation errors. Show the cause, not inputs.
  return text.split(/\r?\n\s*Received arguments:/, 1)[0].trim() || "工具调用失败，未记录具体错误。";
}
