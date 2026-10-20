import { Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableCell, TableHead } from "@/components/ui/table";
export type PluginTool = { name: string; description: string };

// Reuse the compact capability-table treatment from Haze's DeveloperAssetTable.
export function PluginToolList({ tools }: { tools: PluginTool[] | null }) {
  return (
    <section
      aria-label="MCP 工具列表"
      className="space-y-4 border-t border-slate-200 pt-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Wrench className="size-4" />
          TOOL 工具列表
        </h3>
        <Badge className="bg-slate-100 text-slate-600">
          {tools ? `${tools.length} 个工具` : "读取中"}
        </Badge>
      </div>
      <p className="text-xs leading-6 text-slate-500">
        连接后，AI 可以调用下列工具。列表与服务器实际开放的能力保持一致。
      </p>
      {tools ? (
        <Table
          aria-label="MCP 工具"
          containerClassName="h-auto"
          className="table-fixed"
        >
          <thead>
            <tr>
              <TableHead className="w-[42%]">工具名称</TableHead>
              <TableHead>功能说明</TableHead>
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <tr key={tool.name}>
                <TableCell className="align-top">
                  <code className="break-all text-[11px] leading-6">
                    {tool.name}
                  </code>
                </TableCell>
                <TableCell className="whitespace-normal align-top text-xs leading-6">
                  {tool.description}
                </TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="py-6 text-center text-xs text-slate-400">
          读取插件信息后显示可用工具。
        </p>
      )}
    </section>
  );
}
