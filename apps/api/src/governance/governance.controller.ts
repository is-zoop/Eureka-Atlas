import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { GovernanceService } from "./governance.service";
import { CreateWorkspaceInput, GovernanceWorkspaceService, WorkspaceInput } from "./governance-workspace.service";

@Controller("governance/tasks")
export class GovernanceController {
  constructor(private readonly governanceService: GovernanceService) {}

  @Get()
  list() { return this.governanceService.list(); }
}

@Controller("governance/workspaces")
export class GovernanceWorkspaceController {
  constructor(private readonly workspaceService: GovernanceWorkspaceService) {}

  @Post()
  create(@Body() input: CreateWorkspaceInput) { return this.workspaceService.create(input); }

  @Get(":id")
  get(@Param("id") id: string) { return this.workspaceService.get(id); }

  @Put(":id")
  update(@Param("id") id: string, @Body() input: WorkspaceInput) { return this.workspaceService.update(id, input); }

  @Post(":id/generate")
  generate(@Param("id") id: string, @Body() input: WorkspaceInput) { return this.workspaceService.generate(id, input); }

  @Post(":id/publish")
  publish(@Param("id") id: string, @Body() input: WorkspaceInput) { return this.workspaceService.publish(id, input); }
}
