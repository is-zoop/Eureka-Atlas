"use client";

// Copied and adapted from HazeToolPlat/frontend/src/Dashboard/pages/PersonalCenter.tsx.
import { useState } from "react";
import type { AuthUser } from "@eureka-atlas/types";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PersonalSettings } from "./personal-settings";
import { PersonalCredentialPanel } from "./personal-credential";

export function PersonalCenter({ user }: { user: AuthUser }) {
  const [tab, setTab] = useState("settings");
  return <main>
    <PageHeader title="个人中心" description="查看个人信息，维护头像与 Haze 个人服务访问凭证" />
    <section className="rounded-xl border border-slate-200/75 bg-white p-4">
      <Tabs value={tab} onValueChange={setTab} className="space-y-3">
        <TabsList className="h-9 w-fit border-none bg-slate-100/80 p-1"><TabsTrigger value="settings" className="h-7 text-xs">个人设置</TabsTrigger><TabsTrigger value="credentials" className="h-7 text-xs">个人凭证</TabsTrigger></TabsList>
        <TabsContent value="settings" className="mt-0">{tab === "settings" && <PersonalSettings key={user.member_no} user={user} />}</TabsContent>
        <TabsContent value="credentials" className="mt-0">{tab === "credentials" && <PersonalCredentialPanel key={user.member_no} />}</TabsContent>
      </Tabs>
    </section>
  </main>;
}
