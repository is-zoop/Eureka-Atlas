import {
  BadRequestException,
  ConflictException,
  Injectable,
  HttpException,
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

export function generationErrorMessage(cause: unknown, step?: AiGenerationStep): string {
  const message = cause instanceof Error ? cause.message : "";
  if (/[\u3400-\u9fff]/u.test(message)) return message;
  const status = cause instanceof HttpException ? cause.getStatus() : undefined;
  if (status === 401 || status === 403) return "AI 模型鉴权失败，请检查 API Key 或重新登录模型订阅账号";
  if (status === 429) return "AI 模型请求过于频繁或额度不足，请稍后重试并检查账号额度";
  if (step === AiGenerationStep.CALLING_LLM) return "AI 模型调用失败，请检查模型配置、凭证或网络后重试";
  if (step === AiGenerationStep.SAVING_DRAFT) return "保存草稿失败，请检查字段配置后重试";
  if (step === AiGenerationStep.VALIDATING_RESULT) return "AI 返回的建议未通过校验，请重新生成";
  if (step === AiGenerationStep.SAVING_SUGGESTIONS) return "保存 AI 建议失败，请稍后重试";
  return "AI 建议生成失败，请稍后重试";
}

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
    if (!task) throw new NotFoundException("治理任务不存在");
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
    if (!generation) throw new NotFoundException("AI 生成记录不存在");
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
    if (!generation) throw new NotFoundException("AI 生成记录不存在");
    if (generation.status !== AiGenerationStatus.RUNNING)
      throw new ConflictException("本次 AI 生成已结束，不能再取消");
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
      const message = generationErrorMessage(cause, generation?.step);
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
      throw new Error("AI 生成已取消");
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
      throw new BadRequestException("Markdown 文件不能超过 1 MB");
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
      error: generation.error ? generationErrorMessage(new Error(generation.error), generation.step) : null,
      startedAt: generation.startedAt,
      completedAt: generation.completedAt,
    };
  }
}
