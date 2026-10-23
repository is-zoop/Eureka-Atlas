type Presentation = {
  markdown: string;
  displayed_rows: number;
  saved_rows: number;
  truncated: boolean;
};
/** The text channel is the bounded final table; exact raw values remain in structuredContent. */
export function mcpResultText(data: unknown, requestId: string): string {
  const value = data as {
    id?: string;
    status?: string;
    table_id?: string;
    content_version?: string;
    snapshot_date?: string;
    result?: { truncated?: boolean };
    presentation?: Presentation;
  } | null;
  const view = value?.presentation;
  if (!view) return JSON.stringify({ data, request_id: requestId });
  return (
    view.markdown +
    "\n\n结果信息：" +
    JSON.stringify({
      query_id: value.id,
      status: value.status,
      table_id: value.table_id,
      content_version: value.content_version,
      snapshot_date: value.snapshot_date,
      displayed_rows: view.displayed_rows,
      saved_rows: view.saved_rows,
      display_truncated: view.truncated,
      result_truncated: value.result?.truncated,
      request_id: requestId,
    })
  );
}
