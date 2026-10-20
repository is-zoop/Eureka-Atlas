import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@eureka-atlas/database";
import { randomUUID } from "node:crypto";
import { requireMemberNo } from "../auth/member-no";
import { SelectableSemanticTablesService } from "../semantic/selectable-semantic-tables.service";
export type AgentScope = {
  id: string;
  ownerMemberNo: string;
  revision: number;
  tableIds: string[];
};
const conflict = () =>
  new ConflictException({
    code: "SCOPE_CHANGED",
    message: "选数范围已修改，请重新读取会话并确认范围。",
  });
@Injectable()
export class AgentSessionsService {
  constructor(private readonly selectable: SelectableSemanticTablesService) {}
  async create(memberNo: string) {
    requireMemberNo(memberNo);
    return prisma.agentQuerySession.create({
      data: { id: randomUUID(), ownerMemberNo: memberNo },
    });
  }
  async bound(memberNo: string, conversationId: string) {
    requireMemberNo(memberNo);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(conversationId))
      throw new BadRequestException("客户端对话标识无效。");
    const clientConversationId = "claude:" + conversationId;
    return prisma.agentQuerySession.upsert({
      where: {
        ownerMemberNo_clientConversationId: {
          ownerMemberNo: memberNo,
          clientConversationId,
        },
      },
      create: {
        id: randomUUID(),
        ownerMemberNo: memberNo,
        clientConversationId,
      },
      update: {},
    });
  }
  async owned(
    memberNo: string,
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    requireMemberNo(memberNo);
    const row = await tx.agentQuerySession.findFirst({
      where: { id, ownerMemberNo: memberNo },
    });
    if (!row)
      throw new NotFoundException("会话不存在或不属于当前个人凭证所属账号。");
    return row;
  }
  async touch(memberNo: string, id: string) {
    const row = await this.owned(memberNo, id);
    await prisma.agentQuerySession.updateMany({
      where: { id, ownerMemberNo: memberNo },
      data: { updatedAt: new Date() },
    });
    return row;
  }
  private ids(row: { scopeMode: string; selectedTableIds: Prisma.JsonValue }) {
    const value = row.selectedTableIds;
    if (
      !["ALL", "SELECTED"].includes(row.scopeMode) ||
      !Array.isArray(value) ||
      value.some((id) => typeof id !== "string" || !id) ||
      new Set(value).size !== value.length ||
      (row.scopeMode === "ALL" && value.length) ||
      (row.scopeMode === "SELECTED" && !value.length)
    )
      throw new ConflictException({
        code: "SCOPE_INVALID",
        message: "范围记录无效，请在选数页面重新确认；不会自动扩大到全部表。",
      });
    return value as string[];
  }
  async describe(memberNo: string, id: string) {
    const row = await this.owned(memberNo, id),
      available = await this.selectable.list();
    let selected: string[] = [],
      valid = true;
    try {
      selected = this.ids(row);
    } catch {
      valid = false;
    }
    const ids = new Set(available.items.map((t) => t.id)),
      invalid = selected.filter((id) => !ids.has(id));
    await prisma.agentQuerySession.updateMany({
      where: { id, ownerMemberNo: memberNo },
      data: { updatedAt: new Date() },
    });
    return {
      session_id: row.id,
      scope_mode: row.scopeMode,
      scope_revision: row.revision,
      selected_table_ids: selected,
      invalid_table_ids: invalid,
      scope_valid: valid && !invalid.length,
      available_tables: available.items,
      table_count:
        row.scopeMode === "ALL" ? available.items.length : selected.length,
    };
  }
  async resolve(
    memberNo: string,
    id: string,
    revision?: number,
  ): Promise<AgentScope> {
    const row = await this.owned(memberNo, id);
    this.ids(row);
    if (revision !== undefined && row.revision !== revision) throw conflict();
    const available = (await this.selectable.list()).items.map((t) => t.id),
      allowed = new Set(available);
    const selected = row.scopeMode === "ALL" ? available : this.ids(row);
    if (selected.some((id) => !allowed.has(id)))
      throw new ConflictException({
        code: "SCOPE_INVALID",
        message: "选中的表已撤下或失效，请重新选择；不会自动扩大到全部表。",
      });
    await prisma.agentQuerySession.updateMany({
      where: { id, ownerMemberNo: memberNo },
      data: { updatedAt: new Date() },
    });
    return {
      id,
      ownerMemberNo: memberNo,
      revision: row.revision,
      tableIds: selected,
    };
  }
  async update(memberNo: string, id: string, input: unknown) {
    await this.owned(memberNo, id);
    const body = input as {
      scope_mode?: unknown;
      selected_table_ids?: unknown;
      expected_revision?: unknown;
    };
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (k) =>
          !["scope_mode", "selected_table_ids", "expected_revision"].includes(
            k,
          ),
      ) ||
      !Number.isInteger(body.expected_revision) ||
      Number(body.expected_revision) < 0 ||
      Number(body.expected_revision) > 2147483647 ||
      !["ALL", "SELECTED"].includes(String(body.scope_mode)) ||
      !Array.isArray(body.selected_table_ids) ||
      body.selected_table_ids.length > 1000 ||
      body.selected_table_ids.some((v) => typeof v !== "string" || !v) ||
      new Set(body.selected_table_ids).size !==
        body.selected_table_ids.length ||
      (body.scope_mode === "ALL"
        ? body.selected_table_ids.length !== 0
        : body.selected_table_ids.length === 0)
    )
      throw new BadRequestException(
        "必须明确选择 ALL 或非空 SELECTED 范围，并提供最新 expected_revision。",
      );
    const ids = body.selected_table_ids as string[],
      available = new Set(
        (await this.selectable.list()).items.map((t) => t.id),
      );
    if (ids.some((id) => !available.has(id)))
      throw new BadRequestException("已选表不可查询，请刷新后重新选择。");
    const result = await prisma.agentQuerySession.updateMany({
      where: {
        id,
        ownerMemberNo: memberNo,
        revision: Number(body.expected_revision),
      },
      data: {
        scopeMode: String(body.scope_mode),
        selectedTableIds: ids,
        revision: { increment: 1 },
      },
    });
    if (!result.count) throw conflict();
    return this.describe(memberNo, id);
  }
  async lockAdmission(
    tx: Prisma.TransactionClient,
    scope: AgentScope,
    tableId: string,
  ) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM agent_query_session WHERE id=${scope.id} FOR UPDATE`,
    );
    const row = await this.owned(scope.ownerMemberNo, scope.id, tx);
    this.ids(row);
    if (row.revision !== scope.revision) throw conflict();
    if (
      !scope.tableIds.includes(tableId) ||
      (row.scopeMode === "SELECTED" && !this.ids(row).includes(tableId))
    )
      throw new NotFoundException("该表不在当前会话的选数范围内。");
  }
}
