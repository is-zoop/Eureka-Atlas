import { Injectable } from "@nestjs/common";
import { AssetStatus, prisma } from "@eureka-atlas/database";
import type { SemanticSelectableTable, SemanticSelectableTableGroup, SemanticSelectableTablesResponse } from "@eureka-atlas/types" with { "resolution-mode": "import" };
const compare = (a: string, b: string) => a.localeCompare(b, "zh-CN");
@Injectable()
export class SelectableSemanticTablesService {
  /** Directory/eligibility only. Completeness is computed by the current Package when read. */
  async list(): Promise<SemanticSelectableTablesResponse> {
    const tables = await prisma.metaTable.findMany({
      where: { status: AssetStatus.ACTIVE, metaProject: { status: AssetStatus.ACTIVE }, semantic: { isNot: null }, columns: { some: { status: AssetStatus.ACTIVE, semantic: { isNot: null } } } },
      select: { id:true,name:true,semantic:{select:{businessName:true,dataDomain:true}},metaProject:{select:{name:true,catalog:true,schema:true,dataSource:{select:{id:true,name:true}}}} },
    });
    const items: SemanticSelectableTable[] = tables.map(table => ({id:table.id,business_name:table.semantic!.businessName,physical_name:table.name,data_domain:table.semantic!.dataDomain,source:{id:table.metaProject.dataSource.id,name:table.metaProject.dataSource.name,project:table.metaProject.name,catalog:table.metaProject.catalog,schema:table.metaProject.schema}})).sort((a,b)=>compare(a.data_domain??"\uffff",b.data_domain??"\uffff")||compare(a.business_name,b.business_name)||compare(a.physical_name,b.physical_name)||compare(a.id,b.id));
    const groups = Array.from(items.reduce((all,table)=>{const key=table.data_domain??"",group=all.get(key)??{data_domain:table.data_domain,label:table.data_domain??"未分类",tables:[]};group.tables.push(table);all.set(key,group);return all;},new Map<string,SemanticSelectableTableGroup>()).values());
    return {items,groups};
  }
}
