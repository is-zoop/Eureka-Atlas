"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getDefaultListView, getListView, listViewPaths, setListView, subscribeListViews, type ListViewKey } from "./list-view-state";

export function useListView(key: ListViewKey) {
  const state = useSyncExternalStore(subscribeListViews, () => getListView(key), () => getDefaultListView(key));
  const pathname = usePathname();
  const router = useRouter();
  const urlQuery = useSearchParams().toString();
  const path = listViewPaths[key];
  // Memory is authoritative, including on refresh and on returning via an old URL.
  useEffect(() => {
    if (pathname === path && urlQuery !== state.query) {
      router.replace(state.query ? `${path}?${state.query}` : path, { scroll: false });
    }
  }, [pathname, path, urlQuery, state.query, router]);

  const setSearch = useCallback((search: string) => setListView(key, state => ({ ...state, search })), [key]);
  const setField = useCallback((field: string) => setListView(key, state => ({ ...state, field })), [key]);
  const setExpanded = useCallback((update: (expanded: ReadonlySet<string>) => ReadonlySet<string>) => {
    setListView(key, state => ({ ...state, expanded: update(state.expanded) }));
  }, [key]);
  const update = useCallback((changes: Record<string, string | null>, resetPage = true) => {
    setListView(key, state => {
      const params = new URLSearchParams(state.query);
      Object.entries(changes).forEach(([name, value]) => value ? params.set(name, value) : params.delete(name));
      if (resetPage) params.delete("page");
      return { ...state, query: params.toString() };
    });
  }, [key]);
  const reset = useCallback(() => setListView(key, () => getDefaultListView(key)), [key]);
  const params = new URLSearchParams(state.query);
  const q = params.get("q") ?? "";
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (state.search.trim() !== q) update({ q: state.search.trim() });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [state.search, q, update]);

  return {
    ...state, params, setSearch, setField, setExpanded, update, reset,
    canReset: Boolean(state.query || state.search || state.expanded.size || state.field !== getDefaultListView(key).field),
  };
}
