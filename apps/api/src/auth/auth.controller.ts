import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { AuthService } from "./auth.service";
import type { AuthRequest } from "./auth.types";
import { Public } from "./public.decorator";
import { RequirePermission } from "./permission.decorator";

@RequirePermission("assets.read")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body() input: unknown, @Req() request: AuthRequest, @Res({ passthrough: true }) response: Response) {
    return this.auth.login(input, request, response);
  }

  @Get("me")
  me(@Req() request: AuthRequest) { return request.authUser; }

  @Public()
  @Post("logout")
  @HttpCode(200)
  logout(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response) {
    return this.auth.logout(request, response);
  }
}
