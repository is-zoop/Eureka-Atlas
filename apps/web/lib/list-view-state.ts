export type ListViewKey = "assets" | "metrics" | "dimensions";
export type ListViewState = {
  search: string;
  query: string;
  field: string;
  expanded: ReadonlySet<string>;
};

export const listViewPaths: Record<ListViewKey, string> = {
  assets: "/assets/tables",
  metrics: "/semantic/metrics",
  dimensions: "/semantic/dimensions",
};
const defaults: Record<ListViewKey, ListViewState> = {
  assets: { search: "", query: "", field: "space", expanded: new Set() },
  metrics: { search: "", query: "", field: "editStatus", expanded: new Set() },
  dimensions: { search: "", query: "", field: "editStatus", expanded: new Set() },
};
// Deliberately memory-only: a full page load starts with empty selections.
let views = { ...defaults };
const listeners = new Set<() => void>();
export const subscribeListViews = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const getListView = (key: ListViewKey) => views[key];
export const getDefaultListView = (key: ListViewKey) => defaults[key];
export function setListView(key: ListViewKey, update: (state: ListViewState) => ListViewState) {
  views = { ...views, [key]: update(views[key]) };
  listeners.forEach(listener => listener());
}
export function resetListViews() {
  views = { ...defaults };
  listeners.forEach(listener => listener());
}
