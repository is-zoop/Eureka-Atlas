import { SetMetadata } from "@nestjs/common";
import type { AtlasPermission } from "@eureka-atlas/types" with { "resolution-mode": "import" };

export const REQUIRED_PERMISSION = "atlas:required-permission";
export const RequirePermission = (permission: AtlasPermission) => SetMetadata(REQUIRED_PERMISSION, permission);
