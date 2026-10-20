"use client";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
export function IntegrationsTabs({
  children,
  actions,
  help,
}: {
  children: ReactNode;
  actions?: ReactNode;
  help?: ReactNode;
}) {
  const pathname = usePathname(),
    router = useRouter(),
    active = pathname.startsWith("/integrations/plugins") ? "plugins" : "api";
  return (
    <Tabs
      value={active}
      onValueChange={(value) => router.push("/integrations/" + value)}
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* Reuse the shared Haze-style PageHeader layout, without a title heading. */}
      <header className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-5 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <TabsList aria-label="集成方式" className="shrink-0">
            <TabsTrigger value="api">开放 API</TabsTrigger>
            <TabsTrigger value="plugins">Agent 插件</TabsTrigger>
          </TabsList>
          {help}
        </div>
        {actions && (
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </header>
      <TabsContent value={active} className="mt-0 min-h-0 flex-1">
        {children}
      </TabsContent>
    </Tabs>
  );
}
