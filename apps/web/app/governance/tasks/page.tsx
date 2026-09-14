"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { FloatingAlert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/common/status-badge";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { api } from "@/lib/api";

type Task = { id: string; table: { id: string; name: string; project: string }; columnCount: number; semanticCount: number; status: "PENDING" | "PROCESSING" | "REVIEWING" | "COMPLETED"; createdAt: string };

export default function TaskListPage() {
  const [tasks, setTasks] = useState<Task[]>([]); const [error, setError] = useState("");
  useEffect(() => { void api<Task[]>("/governance/tasks").then(setTasks).catch((cause: Error) => setError(cause.message)); }, []);
  return <main>{error && <FloatingAlert type="error">{error}</FloatingAlert>}<Table><thead><tr><TableHead>任务</TableHead><TableHead>表</TableHead><TableHead>字段数量</TableHead><TableHead>正式语义</TableHead><TableHead>状态</TableHead><TableHead>创建时间</TableHead></tr></thead><tbody>{tasks.length === 0 ? <tr><TableCell colSpan={6} className="py-12 text-center text-slate-500"><ClipboardList className="mx-auto mb-2 h-6 w-6" />暂无治理任务</TableCell></tr> : tasks.map((task) => <tr key={task.id}><TableCell><Link className="font-medium text-slate-900 hover:underline" href={`/governance/tables/${task.table.id}?task=${task.id}`}>任务 {task.id.slice(-6)}</Link></TableCell><TableCell><Link className="hover:underline" href={`/assets/tables/${task.table.id}`}>{task.table.name}</Link><div className="mt-1 text-[13px] text-slate-400">{task.table.project}</div></TableCell><TableCell>{task.columnCount}</TableCell><TableCell>{task.semanticCount} 个字段</TableCell><TableCell><StatusBadge status={task.status} /></TableCell><TableCell>{new Date(task.createdAt).toLocaleString()}</TableCell></tr>)}</tbody></Table></main>;
}
