import type { ResultDisplayFormat } from "@eureka-atlas/result-format";
export type { ResultDisplayFormat } from "@eureka-atlas/result-format";

export type SemanticCatalogInfo = {
  id: string;
  name: string;
  description: string;
  aliases: string[];
  usage_notes: string | null;
};

export type SemanticPackageIssue = {
  code: string;
  object_type: "TABLE" | "FIELD" | "METRIC";
  object_id: string;
  path: string;
  message: string;
  affects: string;
};

export type QueryConfig = {
  default_stat_date: { field_id: string | null; format: string };
  storage: "DATE_INCREMENTAL" | "FULL_SNAPSHOT" | null;
};


export type SemanticPackageField = {
  id: string;
  column: string;
  data_type: string;
  normalized_type: string;
  is_partition: boolean;
  name: string;
  type: "METRIC" | "DIMENSION" | "LABEL" | "PARTITION";
  aggregation: string | null;
  unit: string | null;
  groupable: boolean;
  candidate_value_queryable: boolean;
  label_description: string | null;
  catalog: SemanticCatalogInfo | null;
};

export type SemanticPackageMetric = {
  id: string;
  name: string;
  type: "DERIVED";
  formula: string;
  unit: string | null;
  dependencies: Array<{ id: string; column: string }>;
  catalog: SemanticCatalogInfo | null;
};

export type SemanticPackage = {
  schema_version: 1;
  content_version: string;
  updated_at: string;
  source: {
    id: string;
    name: string;
    type: string;
    project: string;
    catalog: string;
    schema: string;
  };
  table: {
    id: string;
    name: string;
    data_domain: string | null;
    business_name: string;
    description: string;
    grain: string[];
    query_config: QueryConfig;
  };
  fields: SemanticPackageField[];
  metrics: SemanticPackageMetric[];
  completeness: {
    status: "COMPLETE" | "INCOMPLETE";
    issues: SemanticPackageIssue[];
  };
};
export type SemanticSearchRequest = {
  keywords?: string[];
  metrics?: string[];
  dimensions?: string[];
  data_domain?: string;
  page?: number;
  page_size?: number;
};

export type SemanticSearchMatch = {
  asset_id: string;
  name: string;
  basis: "EXACT_NAME_OR_ALIAS" | "PARTIAL_NAME_OR_ALIAS" | "DESCRIPTION";
};

export type SemanticSearchCoverage = {
  requested: string;
  status: "MATCHED" | "TENTATIVE" | "AMBIGUOUS" | "MISSING";
  matches: SemanticSearchMatch[];
};

export type SemanticSearchCandidate = {
  description: string;
  metric_options: Array<{ id: string; name: string; kind: "ATOMIC" | "DERIVED"; aggregation: string | null; formula: string | null; unit: string | null; description: string; usage_notes: string | null }>;
  metric_options_total: number;
  table_id: string;
  business_name: string;
  physical_name: string;
  data_domain: string | null;
  source: { name: string; project: string; catalog: string; schema: string };
  grain: string[];
  completeness: SemanticPackage["completeness"];
  match_reasons: Array<{ text: string; basis: "EXACT_NAME_OR_ALIAS" | "PARTIAL_NAME_OR_ALIAS" | "DESCRIPTION" }>;
  coverage: { status: "FULL" | "PARTIAL" | "UNSPECIFIED"; metrics: SemanticSearchCoverage[]; dimensions: SemanticSearchCoverage[] };
};

export type SemanticSelectableTable = {
  id: string;
  business_name: string;
  physical_name: string;
  data_domain: string | null;
  source: {
    id: string;
    name: string;
    project: string;
    catalog: string;
    schema: string;
  };
  completeness?: SemanticPackage["completeness"];
};

export type SemanticSelectableTableGroup = {
  data_domain: string | null;
  label: string;
  tables: SemanticSelectableTable[];
};

export type SemanticSelectableTablesResponse = {
  items: SemanticSelectableTable[];
  groups: SemanticSelectableTableGroup[];
};

export type QueryFilterOperator =
  | "EQ"
  | "NEQ"
  | "GT"
  | "GTE"
  | "LT"
  | "LTE"
  | "BETWEEN"
  | "IN"
  | "IS_NULL"
  | "IS_NOT_NULL"
  | "CONTAINS";

export type QueryFilter = {
  field_id: string;
  operator: QueryFilterOperator;
  values?: string[];
};

export type QueryOrder = { field_id: string; direction: "ASC" | "DESC" };

export type QueryRequest = {
  idempotency_key?: string;
  table_id: string;
  metric_ids: string[];
  dimension_ids?: string[];
  filters?: QueryFilter[];
  date_range?: { start: string; end: string };
  order_by?: QueryOrder[];
  limit?: number;
};

export type DimensionValuesRequest = {
  idempotency_key?: string;
  table_id: string;
  field_id: string;
  keyword?: string;
  filters?: QueryFilter[];
  date_range?: { start: string; end: string };
  limit?: number;
};

export type QueryExecutionStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLING"
  | "CANCELLED"
  | "TIMED_OUT";

export type QueryResultColumn = {
  id: string | null;
  name: string;
  type: string;
  unit: string | null;
  display?: ResultDisplayFormat;
};

export type QueryResult = {
  columns: QueryResultColumn[];
  rows: Array<Array<string | number | boolean | null>>;
  truncated: boolean;
  result_bytes: number;
};

export type QueryExecution = {
  id: string;
  status: QueryExecutionStatus;
  table_id: string;
  submitted_at: string;
  started_at: string | null;
  completed_at: string | null;
  elapsed_ms: number | null;
  error: string | null;
  sql: string;
  content_version: string;
  snapshot_date: string | null;
  result: QueryResult | null;
};

export type AskRunStatus = "RUNNING" | "WAITING_CLARIFICATION" | "SUCCEEDED" | "FAILED" | "CANCELLING" | "CANCELLED" | "INTERRUPTED";
export type AskEvent = { sequence: number; type: "status" | "progress" | "answer" | "clarification" | "error" | "processing"; payload: Record<string, unknown>; created_at: string };
export type AskProcessingStep = {
  id: string;
  message_id: string | null;
  tool_call_id: string | null;
  kind: "message" | "tool";
  name: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  summary: string;
  started_at: string;
  completed_at: string | null;
  elapsed_ms: number | null;
};
export type AskProcessingDetails = { message_count: number; tool_count: number; steps: AskProcessingStep[] };
export type AskClarificationOption = { id: string; summary: string; description: string };
export type AskClarificationResponse = { selected_option_ids: string[]; custom_text: string };
export type AskClarification = {
  id: string;
  question: string;
  selection_mode: "single" | "multiple";
  options: AskClarificationOption[];
  response: AskClarificationResponse | null;
  answer: string | null;
};
export type AskRunMessage = { id: string; sequence: number; role: "USER" | "ASSISTANT" | "TOOL"; content: unknown; created_at: string };
export type AskThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type AskConditionChanges = { inherited: string[]; changed: string[] };
export type AskChartType = "line" | "bar" | "pie";
export type AskChartSpec = {
  query_id: string;
  type: AskChartType;
  title: string;
  x_column: number;
  y_columns: number[];
};
export type AskSavedQueryResult = {
  query_id: string;
  execution: QueryExecution;
  source: { business_name: string; physical_name: string; project: string; catalog: string; schema: string };
  query_definition: QueryRequest | DimensionValuesRequest;
  condition_changes: AskConditionChanges;
  saved_at: string;
};
export type AskRun = {
  id: string;
  session_id: string | null;
  status: AskRunStatus;
  question: string;
  answer: string | null;
  model_id: string;
  model_display_name: string | null;
  model_provider_name: string | null;
  event_cursor: number;
  processing: AskProcessingDetails;
  thinking_level: AskThinkingLevel;
  table_ids: string[];
  clarification: AskClarification | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  condition_changes: AskConditionChanges;
  messages: AskRunMessage[];
  queries: Array<Pick<QueryExecution, "id" | "status" | "table_id" | "content_version" | "snapshot_date" | "error">>;
  result_summaries: Array<{ query_id: string; saved_at: string }>;
  final_query_ids: string[];
  charts: AskChartSpec[];
};
export type AskSession = {
  id: string;
  title: string;
  table_ids: string[];
  model_id: string;
  thinking_level: AskThinkingLevel;
  configuration_version: number;
  created_at: string;
  updated_at: string;
  active_run: Pick<AskRun, "id" | "status" | "question"> | null;
};
export type AskCursorPage<T> = { items: T[]; next_cursor: string | null };
export type AskSessionCreateRequest = { title?: string; table_ids?: string[]; model_id?: string; thinking_level?: AskThinkingLevel };
export type AskSessionUpdateRequest = { title?: string; table_ids?: string[]; model_id?: string; thinking_level?: AskThinkingLevel; expected_configuration_version: number };
export type AskRunCreateRequest = { idempotency_key: string; question: string; expected_configuration_version: number };
export type AskClarificationRequest = AskClarificationResponse & { clarification_id: string };
export type AuthRole = "SYSTEM_ADMIN" | "ADMIN" | "DEVELOPER" | "USER";
export type AtlasPermission = "assets.read" | "governance.write" | "system.manage" | "query.use" | "api.access";

const rolePermissions: Record<AuthRole, readonly AtlasPermission[]> = {
  SYSTEM_ADMIN: ["assets.read", "governance.write", "system.manage", "query.use", "api.access"],
  ADMIN: ["assets.read", "governance.write", "query.use", "api.access"],
  DEVELOPER: ["assets.read", "query.use"],
  USER: ["assets.read", "query.use"],
};

export function isAuthRole(role: unknown): role is AuthRole {
  return typeof role === "string" && Object.hasOwn(rolePermissions, role);
}

export function hasPermission(role: unknown, permission: AtlasPermission): boolean {
  return isAuthRole(role) && rolePermissions[role].includes(permission);
}

export function canAccessPage(role: unknown, pathname: string): boolean {
  if (!isAuthRole(role)) return false;
  if (pathname === "/" || pathname === "/profile") return true;
  const matches = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  if (["/assets/sources", "/models", "/settings"].some(matches)) return hasPermission(role, "system.manage");
  if (pathname === "/integrations/plugins/data-selector") return hasPermission(role, "query.use");
  if (matches("/integrations")) return hasPermission(role, "api.access");
  if (matches("/governance")) return hasPermission(role, "governance.write");
  if (["/assets/tables", "/semantic/metrics", "/semantic/dimensions"].some(matches)) return hasPermission(role, "assets.read");
  if (["/query/ask", "/query/data"].some(matches)) return hasPermission(role, "query.use");
  return false;
}

export interface AuthUser {
  member_no: string;
  name: string;
  phone: string;
  email: string | null;
  avatar_url: string | null;
  department: string;
  role_code: AuthRole;
  role_name: string;
  status: "active";
}

export type PersonalCredential = {
  id: number;
  name: string;
  masked_key: string;
  created_at: string;
  updated_at: string;
};
export type PersonalCredentialSecret = PersonalCredential & { key: string };

export type ExternalQueryRequest = QueryRequest & { content_version: string; idempotency_key: string };
export type ExternalDimensionValuesRequest = DimensionValuesRequest & { content_version: string; idempotency_key: string };
export type ExternalQueryTask = Omit<QueryExecution, "result"> & { expires_at: string };
export type ExternalResponse<T> = { data: T; request_id: string };
export type ExternalErrorResponse = { error: { code: string; message: string }; request_id: string };
export type ExternalApiOperation = {
  id: string; title: string; description: string; method: "GET" | "POST"; path: string; success_status: number;
  request_schema: Record<string, unknown>; params_schema: Record<string, unknown>; response_schema: Record<string, unknown>;
  request_example: Record<string, unknown>; params_example: Record<string, string>; response_example: unknown; notes: string[];
};
export type ExternalApiCatalog = {
  title: string; version: string; base_path: string; authentication: string; workflow: string[];
  limits: Record<string, number>; errors: Array<{ status: number; code: string; description: string }>; operations: ExternalApiOperation[];
};

export type DataQueryMode = "DETAIL" | "AGGREGATE";
export type DataQueryFilterLogic = "AND" | "OR";
export type DataDateFilter = { field_id: string; preset: "YESTERDAY" | "LAST_7_DAYS" | "LAST_30_DAYS" | "LAST_N_DAYS" | "CUSTOM"; days?: number; start?: string; end?: string };
export type DataQueryFilter = (QueryFilter | DataDateFilter) & { logic?: DataQueryFilterLogic };
export type DataQueryRequest = { idempotency_key?: string; table_id: string; mode: DataQueryMode; field_ids: string[]; filters?: DataQueryFilter[]; order_by?: QueryOrder[] };
export type SavedDataQueryConfig = Omit<DataQueryRequest, "idempotency_key">;
export type SavedDataQuery = { id: string; name: string; config: SavedDataQueryConfig; table_name: string; content_version: string; created_at: string; updated_at: string };
export type SavedDataQueryDetail = SavedDataQuery & { current_content_version: string | null; validation_errors: string[] };
export type SavedDataQueryList = { items: SavedDataQuery[]; page: number; page_size: number; total: number; total_pages: number };
export type DataDimensionValuesRequest = { idempotency_key?: string; table_id: string; field_id: string; keyword?: string; filters?: DataQueryFilter[] };
export type DataQueryExecution = Omit<QueryExecution, "result"> & { request: DataQueryRequest; columns: QueryResultColumn[]; row_count: number; truncated: boolean; expires_at: string; resolved_dates: Array<{ field_id: string; start: string; end: string }> };
export type DataQueryResultPage = { columns: QueryResultColumn[]; rows: QueryResult["rows"]; page: number; page_size: number; total: number; total_pages: number; truncated: boolean };
