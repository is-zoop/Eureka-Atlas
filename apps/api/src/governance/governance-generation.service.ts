import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AiGenerationStatus,
  AiGenerationStep,
  GovernanceTaskStatus,
  prisma,
} from "@eureka-atlas/database";
import { GovernanceAiService } from "./governance-ai.service";
import {
  GovernanceWorkspaceService,
  WorkspaceInput,
} from "./governance-workspace.service";

export type GenerationInput = WorkspaceInput & {
  reference?: { fileName?: string; content?: string };
};

const messages: Record<AiGenerationStep, string> = {
  SAVING_DRAFT: "正在保存当前草稿",
  PREPARING_CONTEXT: "正在整理表与字段上下文",
  CALLING_LLM: "正在调用 AI 模型生成建议",
  VALIDATING_RESULT: "正在校验 AI 返回的建议",
  SAVING_SUGGESTIONS: "正在保存 AI 建议",
};

@Injectable()
export class GovernanceGenerationService {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly workspaces: GovernanceWorkspaceService,
    private readonly ai: GovernanceAiService,
  ) {}

  async start(taskId: string, input: GenerationInput) {
    const task = await prisma.governanceTask.findUnique({
      where: { id: taskId },
      select: { id: true, status: true },
    });
    if (!task) throw new NotFoundException("Governance task not found");
    const running = await prisma.aiGeneration.findFirst({
      where: { governanceTaskId: taskId, status: AiGenerationStatus.RUNNING },
      orderBy: { startedAt: "desc" },
    });
    if (running) return this.view(running);
    const reference = this.reference(input.reference);
    const generation = await prisma.aiGeneration.create({
      data: {
        governanceTaskId: taskId,
        previousTaskStatus: task.status,
        step: AiGenerationStep.SAVING_DRAFT,
        message: messages.SAVING_DRAFT,
      },
    });
    void this.run(generation.id, taskId, input, reference).catch(() => undefined);
    return this.view(generation);
  }

  async get(taskId: string, generationId: string) {
    const generation = await prisma.aiGeneration.findFirst({
      where: { id: generationId, governanceTaskId: taskId },
    });
    if (!generation) throw new NotFoundException("AI generation not found");
    return this.view(generation);
  }

  async active(taskId: string) {
    const generation = await prisma.aiGeneration.findFirst({
      where: { governanceTaskId: taskId, status: AiGenerationStatus.RUNNING },
      orderBy: { startedAt: "desc" },
    });
    return generation ? this.view(generation) : null;
  }

  async cancel(taskId: string, generationId: string) {
    const generation = await prisma.aiGeneration.findFirst({
      where: { id: generationId, governanceTaskId: taskId },
    });
    if (!generation) throw new NotFoundException("AI generation not found");
    if (generation.status !== AiGenerationStatus.RUNNING)
      throw new ConflictException("AI generation has already finished");
    this.controllers.get(generationId)?.abort();
    await prisma.$transaction([
      prisma.aiGeneration.update({
        where: { id: generationId },
        data: {
          status: AiGenerationStatus.CANCELLED,
          message: "已取消生成，保留原有 AI 建议",
          completedAt: new Date(),
        },
      }),
      prisma.governanceTask.update({
        where: { id: taskId },
        data: { status: generation.previousTaskStatus },
      }),
    ]);
    return this.get(taskId, generationId);
  }

  private async run(
    generationId: string,
    taskId: string,
    input: GenerationInput,
    referenceMarkdown?: string,
  ) {
    const controller = new AbortController();
    this.controllers.set(generationId, controller);
    try {
      await this.workspaces.update(taskId, input);
      await this.ensureRunning(generationId);
      await prisma.governanceTask.update({
        where: { id: taskId },
        data: { status: GovernanceTaskStatus.PROCESSING },
      });
      await this.ai.execute(taskId, {
        referenceMarkdown,
        signal: controller.signal,
        ensureActive: () => this.ensureRunning(generationId),
        onStep: (step, message) => this.progress(generationId, step, message),
      });
      await this.ensureRunning(generationId);
      await prisma.aiGeneration.update({
        where: { id: generationId },
        data: {
          status: AiGenerationStatus.COMPLETED,
          step: AiGenerationStep.SAVING_SUGGESTIONS,
          message: "AI 建议已生成",
          completedAt: new Date(),
        },
      });
    } catch (cause) {
      const generation = await prisma.aiGeneration.findUnique({
        where: { id: generationId },
      });
      if (generation?.status === AiGenerationStatus.CANCELLED) {
        await prisma.governanceTask.update({
          where: { id: taskId },
          data: { status: generation.previousTaskStatus },
        });
        return;
      }
      const message = cause instanceof Error ? cause.message : "AI 生成失败";
      if (generation) {
        await prisma.$transaction([
          prisma.aiGeneration.update({
            where: { id: generationId },
            data: {
              status: AiGenerationStatus.FAILED,
              message: "AI 建议生成失败",
              error: message,
              completedAt: new Date(),
            },
          }),
          prisma.governanceTask.update({
            where: { id: taskId },
            data: { status: generation.previousTaskStatus },
          }),
        ]);
      }
    } finally {
      this.controllers.delete(generationId);
    }
  }

  private async ensureRunning(generationId: string) {
    const generation = await prisma.aiGeneration.findUnique({
      where: { id: generationId },
      select: { status: true },
    });
    if (generation?.status !== AiGenerationStatus.RUNNING)
      throw new Error("AI generation cancelled");
  }

  private async progress(
    generationId: string,
    step: AiGenerationStep,
    message: string,
  ) {
    await this.ensureRunning(generationId);
    await prisma.aiGeneration.update({
      where: { id: generationId },
      data: { step, message },
    });
  }

  private reference(value: GenerationInput["reference"]) {
    const content = typeof value?.content === "string" ? value.content.trim() : "";
    if (!content) return undefined;
    if (content.length > 1_000_000)
      throw new BadRequestException("Markdown reference must be 1 MB or smaller");
    return content;
  }

  private view(generation: {
    id: string;
    status: AiGenerationStatus;
    step: AiGenerationStep;
    message: string;
    error: string | null;
    startedAt: Date;
    completedAt: Date | null;
  }) {
    return {
      id: generation.id,
      status: generation.status,
      step: generation.step,
      message: generation.message,
      error: generation.error,
      startedAt: generation.startedAt,
      completedAt: generation.completedAt,
    };
  }
}
