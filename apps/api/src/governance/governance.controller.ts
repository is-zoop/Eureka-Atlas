import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { AuthRequest } from "../auth/auth.types";
import { requestMemberNo } from "../auth/member-no";
import { GovernanceService } from "./governance.service";
import { CreateWorkspaceInput, FormulaValidationInput, GovernanceWorkspaceService, WorkspaceInput } from "./governance-workspace.service";
import { GenerationInput, GovernanceGenerationService } from "./governance-generation.service";

@Controller("governance/tasks")
export class GovernanceController {
  constructor(private readonly governanceService: GovernanceService) {}

  @Get()
  list() { return this.governanceService.list(); }
}

@Controller("governance/workspaces")
export class GovernanceWorkspaceController {
  constructor(private readonly workspaceService: GovernanceWorkspaceService, private readonly generations: GovernanceGenerationService) {}

  @Post()
  create(@Body() input: CreateWorkspaceInput) { return this.workspaceService.create(input); }

  @Post("formulas/validate")
  validateFormula(@Body() input: FormulaValidationInput) { return this.workspaceService.validateFormula(input); }

  @Get("by-table/:tableId")
  resolveForTable(@Param("tableId") tableId: string, @Query("task") taskId?: string) { return this.workspaceService.resolveForTable(tableId, taskId); }

  @Get(":id")
  get(@Param("id") id: string) { return this.workspaceService.get(id); }

  @Put(":id")
  update(@Param("id") id: string, @Body() input: WorkspaceInput) { return this.workspaceService.update(id, input); }

  @Post(":id/generations")
  startGeneration(@Param("id") id: string, @Body() input: GenerationInput) { return this.generations.start(id, input); }

  @Get(":id/generations/active")
  activeGeneration(@Param("id") id: string) { return this.generations.active(id); }

  @Get(":id/generations/:generationId")
  generation(@Param("id") id: string, @Param("generationId") generationId: string) { return this.generations.get(id, generationId); }

  @Post(":id/generations/:generationId/cancel")
  cancelGeneration(@Param("id") id: string, @Param("generationId") generationId: string) { return this.generations.cancel(id, generationId); }

  @Post(":id/publish")
  publish(@Req() request: AuthRequest, @Param("id") id: string, @Body() input: WorkspaceInput) {
    return this.workspaceService.publish(id, { member_no: requestMemberNo(request), name: request.authUser!.name }, input);
  }
}
