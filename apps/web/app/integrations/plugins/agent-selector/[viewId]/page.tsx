import type { Metadata } from "next";
import { AgentSelection } from "@/components/integrations/agent-selection";
export const metadata: Metadata = {
  title: "Atlas 当前对话选数",
  referrer: "no-referrer",
};
export default async function Page({
  params,
}: {
  params: Promise<{ viewId: string }>;
}) {
  return (
    <AgentSelection
      key={(await params).viewId}
      viewId={(await params).viewId}
    />
  );
}
