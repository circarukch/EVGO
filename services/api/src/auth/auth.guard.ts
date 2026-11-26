import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

export interface AuthUser {
  id: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = String(req.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException("Log in first");
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ?: string }>(token);
      // Console (operator) tokens are not customer logins.
      if (payload.typ) throw new Error("not a customer token");
      req.user = { id: payload.sub } satisfies AuthUser;
      return true;
    } catch {
      throw new UnauthorizedException("Session expired. Log in again");
    }
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
