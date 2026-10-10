import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@eureka-atlas/database";
import type { AskEvent } from "@eureka-atlas/types" with { "resolution-mode": "import" };

type Listener = (event: AskEvent) => void;

@Injectable()
export class AskEventService {
  private listeners = new Map<string, Set<Listener>>();

  async publish(runId: string, type: AskEvent["type"], payload: Record<string, unknown>) {
    const saved = await prisma.$transaction(async (tx) => {
      const run = await tx.askRun.update({ where: { id: runId }, data: { nextEventSequence: { increment: 1 } }, select: { nextEventSequence: true } });
      return tx.askRunEvent.create({ data: { askRunId: runId, sequence: run.nextEventSequence, type, payload: payload as Prisma.InputJsonValue } });
    });
    const event: AskEvent = { sequence: saved.sequence, type: saved.type as AskEvent["type"], payload, created_at: saved.createdAt.toISOString() };
    this.listeners.get(runId)?.forEach((listener) => listener(event));
    return event;
  }

  async after(runId: string, sequence: number) {
    return (await prisma.askRunEvent.findMany({ where: { askRunId: runId, sequence: { gt: sequence } }, orderBy: { sequence: "asc" } })).map((event): AskEvent => ({ sequence: event.sequence, type: event.type as AskEvent["type"], payload: event.payload as Record<string, unknown>, created_at: event.createdAt.toISOString() }));
  }

  subscribe(runId: string, listener: Listener) {
    const set = this.listeners.get(runId) ?? new Set<Listener>();
    set.add(listener); this.listeners.set(runId, set);
    return () => { set.delete(listener); if (!set.size) this.listeners.delete(runId); };
  }
}