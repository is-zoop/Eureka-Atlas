import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import type { AuthRequest } from "./auth.types";
import { RequirePermission } from "./permission.decorator";
import { ProfileService } from "./profile.service";

@RequirePermission("assets.read")
@Controller("auth/me")
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Patch("profile")
  updateAvatar(@Body() input: unknown, @Req() request: AuthRequest) { return this.profile.updateAvatar(input, request); }

  @Post("reset-password")
  @HttpCode(200)
  resetPassword(@Body() input: unknown, @Req() request: AuthRequest, @Res({ passthrough: true }) response: Response) { return this.profile.resetPassword(input, request, response); }

  @Get("mcp-credential")
  credential(@Req() request: AuthRequest) { return this.profile.credential(request); }

  @Post("mcp-credential/reveal")
  @HttpCode(200)
  revealCredential(@Req() request: AuthRequest) { return this.profile.revealCredential(request); }

  @Post("mcp-credential/reset")
  @HttpCode(200)
  resetCredential(@Req() request: AuthRequest) { return this.profile.resetCredential(request); }
}
