import { BadRequestException } from "@nestjs/common";
const sessionIdSchema = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9_-]+$",
  description: "当前对话的业务会话标识，不是MCP连接ID。",
};
export const contextProperties = {
  session_id: sessionIdSchema,
  scope_revision: {
    type: "integer",
    minimum: 0,
    maximum: 2147483647,
    description: "get_query_session返回的当前范围版本；范围修改后必须刷新。",
  },
};
export function readContext(args: Record<string, unknown>, revision = false) {
  const id = args.session_id;
  if (
    typeof id !== "string" ||
    !new RegExp(sessionIdSchema.pattern).test(id) ||
    id.length > 128 ||
    ((revision || args.scope_revision !== undefined) &&
      (!Number.isInteger(args.scope_revision) ||
        Number(args.scope_revision) < 0 ||
        Number(args.scope_revision) > 2147483647))
  )
    throw new BadRequestException(
      "需要有效的 session_id 和当前 scope_revision。",
    );
  return { id, revision: Number(args.scope_revision) };
}
