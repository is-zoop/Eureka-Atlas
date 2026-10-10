import type { Message } from "@earendil-works/pi-ai" with { "resolution-mode": "import" };

export function completeToolHistory(messages: Message[]): boolean {
  const pending = new Map<string, string>();
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.role === "toolResult") {
      if (!pending.has(message.toolCallId) || pending.get(message.toolCallId) !== message.toolName) return false;
      pending.delete(message.toolCallId);
    } else {
      // A new user/assistant message cannot interrupt an unfinished tool batch.
      if (pending.size) return false;
      if (message.role !== "assistant") continue;
      // Pi excludes these assistant messages during provider conversion, so any
      // associated results would lose their originating calls during replay.
      if (message.stopReason === "error" || message.stopReason === "aborted") return false;
      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        if (!block.id || seen.has(block.id)) return false;
        seen.add(block.id);
        pending.set(block.id, block.name);
      }
    }
  }
  return pending.size === 0;
}

export type AskHistoryReference = { runId: string; sequence: number };
export type AskHistoryCheckpoint = { summary: string; coveredCount: number };
export type AskHistory = {
  messages: Message[];
  references: AskHistoryReference[];
  checkpoint?: AskHistoryCheckpoint;
};
