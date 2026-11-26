import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config";

/**
 * Stand-in for operator login: the console server sends a shared key.
 * Replaced by operator accounts with roles (RBAC) when the console gets its own login.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const key = String(ctx.switchToHttp().getRequest().headers["x-admin-key"] ?? "");
    const a = Buffer.from(key);
    const b = Buffer.from(config.adminApiKey);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException("Admin key required");
    return true;
  }
}
