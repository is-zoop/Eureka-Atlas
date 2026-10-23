import type { Request } from "express";
import type { AuthUser } from "@eureka-atlas/types" with { "resolution-mode": "import" };

export type AuthRequest = Request & { authUser?: AuthUser; authElapsedMs?: number };
