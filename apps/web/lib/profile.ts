import type { AuthUser, PersonalCredential, PersonalCredentialSecret } from "@eureka-atlas/types";
import { api } from "./api";
import { endSession } from "./auth";

export function updateProfileAvatar(avatarUrl: string | null, signal?: AbortSignal) {
  return api<AuthUser>("/auth/me/profile", { method: "PATCH", body: JSON.stringify({ avatar_url: avatarUrl }), signal });
}

export async function resetOwnPassword(currentPassword: string, newPassword: string, signal?: AbortSignal) {
  await api<{ reset: true }>("/auth/me/reset-password", { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }), signal });
  endSession();
}

export function getPersonalCredential(signal?: AbortSignal) {
  return api<PersonalCredential>("/auth/me/mcp-credential", { signal });
}

export function revealPersonalCredential(signal?: AbortSignal) {
  return api<PersonalCredentialSecret>("/auth/me/mcp-credential/reveal", { method: "POST", signal });
}

export function resetPersonalCredential(signal?: AbortSignal) {
  return api<PersonalCredentialSecret>("/auth/me/mcp-credential/reset", { method: "POST", signal });
}
