"use client";

import { useSyncExternalStore } from "react";
import type { AuthUser } from "@eureka-atlas/types";
import { api, invalidateApiRequests, AUTH_ACCOUNT_CHANGED_EVENT, AUTH_UNAUTHORIZED_EVENT } from "./api";
import { resetListViews } from "./list-view-state";

type AuthState = { status: "loading" | "authenticated" | "unauthenticated" | "unavailable"; user: AuthUser | null; error: string | null };
const initialState: AuthState = { status: "loading", user: null, error: null };
let state = initialState;
let version = 0;
let pending: Promise<void> | undefined;
let refreshController: AbortController | undefined;
let authChannel: BroadcastChannel | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = (next: AuthState) => { state = next; listeners.forEach(listener => listener()); };

export const getAuthSnapshot = () => state;
export const useAuth = () => useSyncExternalStore(subscribe, getAuthSnapshot, () => initialState);

export function clearAuth() {
  resetListViews();
  version++;
  invalidateApiRequests();
  refreshController?.abort();
  refreshController = undefined;
  pending = undefined;
  publish({ status: "unauthenticated", user: null, error: null });
}

export function notifySessionExpired() {
  clearAuth();
  window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
}

function acceptUser(user: AuthUser) {
  if (state.user?.member_no !== user.member_no || state.user?.role_code !== user.role_code) {
    resetListViews();
    invalidateApiRequests();
    window.dispatchEvent(new Event(AUTH_ACCOUNT_CHANGED_EVENT));
  }
  publish({ status: "authenticated", user, error: null });
}

// Notifications carry no user or token data; other tabs read their own Cookie.
export function watchAuthChanges(): () => void {
  const channel = new BroadcastChannel("eureka-atlas:auth");
  authChannel = channel;
  channel.onmessage = (event) => {
    if (event.data === "profile-updated") { void refreshAuth(); return; }
    resetListViews();
    version++;
    refreshController?.abort();
    refreshController = undefined;
    pending = undefined;
    invalidateApiRequests();
    window.dispatchEvent(new Event(AUTH_ACCOUNT_CHANGED_EVENT));
    publish({ status: "loading", user: null, error: null });
    void refreshAuth();
  };
  return () => { if (authChannel === channel) authChannel = undefined; channel.close(); };
}

function announceAuthChange(message: "changed" | "profile-updated" = "changed") {
  if (authChannel) { authChannel.postMessage(message); return; }
  const channel = new BroadcastChannel("eureka-atlas:auth");
  channel.postMessage(message);
  channel.close();
}

export function refreshAuth(): Promise<void> {
  if (pending) return pending;
  const ticket = version;
  const controller = new AbortController();
  refreshController = controller;
  const work = (async () => {
    try {
      const user = await api<AuthUser>("/auth/me", { signal: controller.signal });
      if (ticket === version) acceptUser(user);
    } catch (cause) {
      if (ticket !== version) return;
      if ((cause as { status?: number }).status === 401) clearAuth();
      else publish({ status: "unavailable", user: state.user, error: cause instanceof Error ? cause.message : "登录服务暂时不可用，请重试。" });
    }
  })();
  pending = work;
  void work.finally(() => {
    if (pending === work) pending = undefined;
    if (refreshController === controller) refreshController = undefined;
  });
  return work;
}

export async function login(phone: string, password: string) {
  const ticket = ++version;
  invalidateApiRequests();
  refreshController?.abort();
  refreshController = undefined;
  const work = api<AuthUser>("/auth/login", { method: "POST", body: JSON.stringify({ phone: phone.trim(), password }) });
  pending = work.then(() => {}, () => {});
  try {
    const user = await work;
    if (ticket === version) { resetListViews(); acceptUser(user); announceAuthChange(); }
  } finally {
    if (ticket === version) pending = undefined;
  }
}

export function updateAuthUser(user: AuthUser) {
  if (state.status !== "authenticated" || state.user?.member_no !== user.member_no) return;
  acceptUser(user);
  announceAuthChange("profile-updated");
}

export function endSession() {
  notifySessionExpired();
  announceAuthChange();
}

export async function logout() {
  await api("/auth/logout", { method: "POST" });
  endSession();
}
