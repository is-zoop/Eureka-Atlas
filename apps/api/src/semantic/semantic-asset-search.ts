import type {
  SemanticPackage,
  SemanticSearchCandidate,
  SemanticSearchCoverage,
  SemanticSearchMatch,
  SemanticSearchRequest,
} from "@eureka-atlas/types" with { "resolution-mode": "import" };

export type {
  SemanticSearchCandidate,
  SemanticSearchCoverage,
  SemanticSearchMatch,
  SemanticSearchRequest,
};
type Catalog = { id: string; name: string; description: string; aliases: string[]; usage_notes: string | null } | null;
type Field = { id: string; name: string; type: "METRIC" | "DIMENSION" | "LABEL" | "PARTITION"; groupable: boolean; catalog: Catalog };
type Metric = { id: string; name: string; catalog: Catalog };
type SearchPackage = SemanticPackage & { fields: Field[]; metrics: Metric[] };
type Asset = { id: string; name: string; aliases: string[]; description: string; usageNotes: string };

const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
const terms = (values: string[] | undefined) => [...new Set((values ?? []).map(normalize).filter(Boolean))];
const asset = (id: string, name: string, catalog: Catalog): Asset => ({ id, name, aliases: catalog?.aliases ?? [], description: catalog?.description ?? "", usageNotes: catalog?.usage_notes ?? "" });
function match(term: string, item: Asset): SemanticSearchMatch | null {
  const names = [item.name, ...item.aliases].map(normalize).filter(Boolean);
  if (names.some((value) => value === term)) return { asset_id: item.id, name: item.name, basis: "EXACT_NAME_OR_ALIAS" };
  if (names.some((value) => value.includes(term) || term.includes(value))) return { asset_id: item.id, name: item.name, basis: "PARTIAL_NAME_OR_ALIAS" };
  if ([item.description, item.usageNotes].map(normalize).some((value) => value.includes(term))) return { asset_id: item.id, name: item.name, basis: "DESCRIPTION" };
  return null;
}
function coverage(requested: string[], assets: Asset[]): SemanticSearchCoverage[] {
  return requested.map((term) => {
    const matches = assets.map((item) => match(term, item)).filter((item): item is SemanticSearchMatch => Boolean(item));
    const exact = matches.filter((item) => item.basis === "EXACT_NAME_OR_ALIAS");
    return { requested: term, status: exact.length > 1 ? "AMBIGUOUS" : exact.length === 1 ? "MATCHED" : matches.length ? "TENTATIVE" : "MISSING", matches };
  });
}
function tableReasons(requested: string[], source: SearchPackage): SemanticSearchCandidate["match_reasons"] {
  const tableAsset: Asset = { id: source.table.id, name: `${source.table.business_name} ${source.table.name}`, aliases: [], description: source.table.description, usageNotes: "" };
  const assets = [tableAsset, ...source.fields.map((item) => asset(item.id, item.name, item.catalog)), ...source.metrics.map((item) => asset(item.id, item.name, item.catalog))];
  return requested.flatMap((term) => assets.map((item) => match(term, item)).filter((item): item is SemanticSearchMatch => Boolean(item)).map((item) => ({ text: term, basis: item.basis }))).filter((item, index, all) => all.findIndex((other) => other.text === item.text && other.basis === item.basis) === index);
}
export function searchSemanticPackages(packages: SearchPackage[], input: SemanticSearchRequest) {
  const keywordTerms = terms(input.keywords); const metricTerms = terms(input.metrics); const dimensionTerms = terms(input.dimensions); const domain = normalize(input.data_domain ?? "");
  if (!keywordTerms.length && !metricTerms.length && !dimensionTerms.length) throw new Error("请至少输入业务关键词、指标或维度");
  const candidates = packages.filter((item) => !domain || normalize(item.table.data_domain ?? "") === domain).map((item) => {
    const metricAssets = [...item.fields.filter((field) => field.type === "METRIC").map((field) => asset(field.id, field.name, field.catalog)), ...item.metrics.map((metric) => asset(metric.id, metric.name, metric.catalog))];
    const dimensionAssets = item.fields.filter((field) => field.type === "DIMENSION" || ((field.type === "LABEL" || field.type === "PARTITION") && field.groupable)).map((field) => asset(field.id, field.name, field.catalog));
    const metricCoverage = coverage(metricTerms, metricAssets); const dimensionCoverage = coverage(dimensionTerms, dimensionAssets); const reasons = tableReasons(keywordTerms, item);
    const requestedCoverage = [...metricCoverage, ...dimensionCoverage];
    const matched = requestedCoverage.filter((entry) => entry.status === "MATCHED").length;
    const missing = requestedCoverage.filter((entry) => entry.status === "MISSING").length;
    const status = requestedCoverage.length === 0 ? "UNSPECIFIED" : missing === 0 && requestedCoverage.every((entry) => entry.status === "MATCHED") ? "FULL" : "PARTIAL";
    const candidate: SemanticSearchCandidate = { table_id: item.table.id, business_name: item.table.business_name, physical_name: item.table.name, data_domain: item.table.data_domain, source: item.source, grain: item.table.grain, completeness: item.completeness, match_reasons: reasons, coverage: { status, metrics: metricCoverage, dimensions: dimensionCoverage } };
    return { candidate, matched, missing, exactReasons: reasons.filter((reason) => reason.basis === "EXACT_NAME_OR_ALIAS").length, any: Boolean(reasons.length || matched || requestedCoverage.some((entry) => entry.status !== "MISSING")) };
  }).filter((item) => item.any).sort((left, right) => (Number(right.candidate.coverage.status === "FULL") - Number(left.candidate.coverage.status === "FULL")) || (right.matched - left.matched) || (right.exactReasons - left.exactReasons) || (left.missing - right.missing) || left.candidate.table_id.localeCompare(right.candidate.table_id));
  const pageSize = Math.min(100, Math.max(1, Number(input.page_size) || 20)); const page = Math.max(1, Number(input.page) || 1); const total = candidates.length;
  return { items: candidates.slice((page - 1) * pageSize, page * pageSize).map((item) => item.candidate), total, page, page_size: pageSize, total_pages: Math.max(1, Math.ceil(total / pageSize)) };
}
