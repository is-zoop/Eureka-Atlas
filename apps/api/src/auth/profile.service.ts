import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Response } from "express";
import type { PersonalCredential, PersonalCredentialSecret } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import { AuthService } from "./auth.service";
import type { AuthRequest } from "./auth.types";
import { HazeAuthService } from "./haze-auth.service";

function body(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new BadRequestException("提交的信息不符合要求。");
  return value as Record<string, unknown>;
}
function metadata(value: PersonalCredentialSecret): PersonalCredential {
  return { id: value.id, name: value.name, masked_key: value.masked_key, created_at: value.created_at, updated_at: value.updated_at };
}

@Injectable()
export class ProfileService {
  constructor(private readonly auth: AuthService, private readonly haze: HazeAuthService) {}

  async updateAvatar(input: unknown, request: AuthRequest) {
    const { avatar_url: avatar } = body(input, ["avatar_url"]);
    if (avatar !== null) {
      if (typeof avatar !== "string" || avatar.length > 65_000 || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)) throw new BadRequestException("头像必须为 JPG、PNG 或 WebP 图片，编码后不能超过 65000 字符。");
      const encoded = avatar.slice(avatar.indexOf(",") + 1);
      if (Buffer.from(encoded, "base64").toString("base64") !== encoded) throw new BadRequestException("头像图片编码无效。");
    }
    const user = await this.haze.updateAvatar(await this.auth.sessionToken(request), avatar as string | null);
    if (user.member_no !== request.authUser!.member_no) throw new ServiceUnavailableException("Haze 返回的个人资料与当前账号不一致。");
    return user;
  }

  async resetPassword(input: unknown, request: AuthRequest, response: Response) {
    const value = body(input, ["current_password", "new_password"]);
    if ([value.current_password, value.new_password].some(password => typeof password !== "string" || password.length < 6 || password.length > 128)) throw new BadRequestException("密码长度应为 6 至 128 位。");
    await this.haze.resetPassword(await this.auth.sessionToken(request), value.current_password as string, value.new_password as string);
    // Haze has revoked the old token. Clear only the local session; never call
    // Haze logout with that token or turn a successful password change into 401.
    await this.auth.logout(request, response);
    return { reset: true };
  }

  async credential(request: AuthRequest) {
    return metadata(await this.haze.credential(await this.auth.sessionToken(request)));
  }

  async revealCredential(request: AuthRequest) {
    return this.haze.credential(await this.auth.sessionToken(request));
  }

  async resetCredential(request: AuthRequest) {
    return this.haze.credential(await this.auth.sessionToken(request), true);
  }
}
