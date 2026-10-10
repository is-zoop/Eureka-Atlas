import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { SubscriptionAuthService } from "./subscription-auth.service";

@Controller("models/providers/:id/subscription")
export class SubscriptionAuthController {
  constructor(private readonly subscriptions: SubscriptionAuthService) {}
  @Post("login") login(@Param("id") id: string) { return this.subscriptions.start(id); }
  @Get("login/:loginId") status(@Param("id") id: string, @Param("loginId") loginId: string) { return this.subscriptions.status(id, loginId); }
  @Post("login/:loginId/input") input(@Param("id") id: string, @Param("loginId") loginId: string, @Body() body: unknown) { return this.subscriptions.answer(id, loginId, body); }
  @Delete("login/:loginId") cancel(@Param("id") id: string, @Param("loginId") loginId: string) { return this.subscriptions.cancel(id, loginId); }
  @Delete() logout(@Param("id") id: string) { return this.subscriptions.logout(id); }
  @Get("catalog") catalog(@Param("id") id: string) { return this.subscriptions.catalog(id); }
  @Post("refresh") refresh(@Param("id") id: string) { return this.subscriptions.refresh(id); }
}
