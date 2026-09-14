import type { ComponentType, CSSProperties } from "react";
import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import GoogleIcon from "@lobehub/icons/es/Google/components/Color";
import DeepSeekIcon from "@lobehub/icons/es/DeepSeek/components/Color";
import GroqIcon from "@lobehub/icons/es/Groq/components/Mono";
import MistralIcon from "@lobehub/icons/es/Mistral/components/Color";
import MoonshotIcon from "@lobehub/icons/es/Moonshot/components/Mono";
import MiniMaxIcon from "@lobehub/icons/es/Minimax/components/Color";
import FireworksIcon from "@lobehub/icons/es/Fireworks/components/Color";
import HuggingFaceIcon from "@lobehub/icons/es/HuggingFace/components/Color";
import CerebrasIcon from "@lobehub/icons/es/Cerebras/components/Color";
import OpenRouterIcon from "@lobehub/icons/es/OpenRouter/components/Mono";
import XAIIcon from "@lobehub/icons/es/XAI/components/Mono";
import CloudflareIcon from "@lobehub/icons/es/Cloudflare/components/Color";
import VercelIcon from "@lobehub/icons/es/Vercel/components/Mono";
import GithubCopilotIcon from "@lobehub/icons/es/GithubCopilot/components/Mono";
import AwsIcon from "@lobehub/icons/es/Aws/components/Color";
import AzureIcon from "@lobehub/icons/es/Azure/components/Color";
import KimiIcon from "@lobehub/icons/es/Kimi/components/Color";
import QwenIcon from "@lobehub/icons/es/Qwen/components/Color";
import ZhipuIcon from "@lobehub/icons/es/Zhipu/components/Color";
import CohereIcon from "@lobehub/icons/es/Cohere/components/Color";
import PerplexityIcon from "@lobehub/icons/es/Perplexity/components/Color";
import TogetherIcon from "@lobehub/icons/es/Together/components/Color";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import AntGroupIcon from "@lobehub/icons/es/AntGroup/components/Color";
import NvidiaIcon from "@lobehub/icons/es/Nvidia/components/Color";
import OpenCodeIcon from "@lobehub/icons/es/OpenCode/components/Mono";
import XiaomiIcon from "@lobehub/icons/es/XiaomiMiMo/components/Mono";
import ZAIIcon from "@lobehub/icons/es/ZAI/components/Mono";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<{ size?: number | string; style?: CSSProperties }>;
type ProviderIconDefinition = { Icon: IconComponent; color: boolean };

const providerIcons: Record<string, ProviderIconDefinition> = {
  anthropic: { Icon: AnthropicIcon, color: false }, openai: { Icon: OpenAIIcon, color: false }, "openai-codex": { Icon: OpenAIIcon, color: false }, google: { Icon: GoogleIcon, color: true }, "google-vertex": { Icon: GoogleIcon, color: true }, "ant-ling": { Icon: AntGroupIcon, color: true }, deepseek: { Icon: DeepSeekIcon, color: true }, groq: { Icon: GroqIcon, color: false }, mistral: { Icon: MistralIcon, color: true }, moonshotai: { Icon: MoonshotIcon, color: false }, "moonshotai-cn": { Icon: MoonshotIcon, color: false }, moonshot: { Icon: MoonshotIcon, color: false }, minimax: { Icon: MiniMaxIcon, color: true }, "minimax-cn": { Icon: MiniMaxIcon, color: true }, fireworks: { Icon: FireworksIcon, color: true }, huggingface: { Icon: HuggingFaceIcon, color: true }, cerebras: { Icon: CerebrasIcon, color: true }, openrouter: { Icon: OpenRouterIcon, color: false }, xai: { Icon: XAIIcon, color: false }, "cloudflare-ai-gateway": { Icon: CloudflareIcon, color: true }, "cloudflare-workers-ai": { Icon: CloudflareIcon, color: true }, "vercel-ai-gateway": { Icon: VercelIcon, color: false }, "github-copilot": { Icon: GithubCopilotIcon, color: false }, "amazon-bedrock": { Icon: AwsIcon, color: true }, "azure-openai-responses": { Icon: AzureIcon, color: true }, "kimi-coding": { Icon: KimiIcon, color: true }, nvidia: { Icon: NvidiaIcon, color: true }, opencode: { Icon: OpenCodeIcon, color: false }, "opencode-go": { Icon: OpenCodeIcon, color: false }, qwen: { Icon: QwenIcon, color: true }, xiaomi: { Icon: XiaomiIcon, color: false }, "xiaomi-token-plan-ams": { Icon: XiaomiIcon, color: false }, "xiaomi-token-plan-cn": { Icon: XiaomiIcon, color: false }, "xiaomi-token-plan-sgp": { Icon: XiaomiIcon, color: false }, zai: { Icon: ZAIIcon, color: false }, "zai-coding-cn": { Icon: ZAIIcon, color: false }, zhipu: { Icon: ZhipuIcon, color: true }, cohere: { Icon: CohereIcon, color: true }, perplexity: { Icon: PerplexityIcon, color: true }, together: { Icon: TogetherIcon, color: true }, grok: { Icon: GrokIcon, color: false },
};

export function ProviderIcon({ id, name, size = 24, className }: { id?: string | null; name: string; size?: number; className?: string }) {
  const normalized = (id ?? "").toLowerCase();
  const item = providerIcons[normalized];
  if (item) { const Icon = item.Icon; return <Icon size={size} style={item.color ? undefined : { color: "#64748b" }} />; }
  const label = (normalized || name).split(/[-_ ]/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  return <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center rounded border border-slate-200 text-[11px] font-semibold text-slate-500", className)} style={{ width: size, height: size }}>{label}</span>;
}
