import { ColumnSemanticType } from "@eureka-atlas/database";

export type SemanticPackageContent = {
  table: {
    name: string;
    business_name: string;
    description: string;
    grain: string;
    permission_field: string | null;
  };
  fields: Array<{
    column: string;
    name: string;
    type: ColumnSemanticType;
    aggregation: string | null;
    unit: string | null;
  }>;
  metrics: Array<{
    name: string;
    type: "DERIVED";
    formula: string;
    unit: string | null;
    dependencies: Array<{
      column: string;
    }>;
  }>;
};

type PackageSource = {
  name: string;
  semantic: {
    businessName: string;
    description: string;
    grain: string;
    permissionColumn: { name: string } | null;
  } | null;
  columns: Array<{
    name: string;
    semantic: {
      metricName: string;
      semanticType: ColumnSemanticType;
      aggregation: string | null;
      unit: string | null;
    } | null;
  }>;
  semanticMetrics: Array<{
    name: string;
    formula: string;
    unit: string | null;
    dependencies: unknown;
  }>;
};

export function buildSemanticPackage(
  source: PackageSource,
): SemanticPackageContent {
  if (!source.semantic) throw new Error("Missing table semantic");
  const fields = source.columns.flatMap((column) =>
    column.semantic
      ? [
          {
            column: column.name,
            name: column.semantic.metricName,
            type: column.semantic.semanticType,
            aggregation: column.semantic.aggregation,
            unit: column.semantic.unit,
          },
        ]
      : [],
  );
  const metrics = (source.semanticMetrics ?? []).map((metric) => {
    const dependencies = Array.isArray(metric.dependencies)
      ? metric.dependencies.filter(
          (item): item is {
            column: string;
            meta_column_id: string;
          } => Boolean(item && typeof item === "object"),
        )
      : [];
    return {
      name: metric.name,
      type: "DERIVED" as const,
      formula: metric.formula,
      unit: metric.unit,
      dependencies: dependencies.map((dependency) => ({
        column: dependency.column,
      })),
    };
  });
  return {
    table: {
      name: source.name,
      business_name: source.semantic.businessName,
      description: source.semantic.description,
      grain: source.semantic.grain,
      permission_field: source.semantic.permissionColumn?.name ?? null,
    },
    fields,
    metrics,
  };
}
