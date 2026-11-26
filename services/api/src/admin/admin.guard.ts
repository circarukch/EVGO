import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { PrismaService } from "../prisma/prisma.service";

export const OPERATOR_ROLES = ["admin", "station_operator"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

/** Who is calling the admin API: a console user, or a script holding the admin key (acts as admin). */
export interface OperatorPrincipal {
  id: string;
  email: string;
  role: OperatorRole;
  /** The operator's organisation; null for the admin key. */
  orgId: string | null;
}

/** Roles allowed on a controller or route. Without it, admin only. */
export const OperatorRoles = (...roles: OperatorRole[]) => SetMetadata("operatorRoles", roles);
/** Lets a signed-in user who still has to change their temporary password through (me, change password). */
export const AllowBeforePasswordChange = () => SetMetadata("allowBeforePasswordChange", true);

export const CurrentOperator = createParamDecorator((_d: unknown, ctx: ExecutionContext): OperatorPrincipal => ctx.switchToHttp().getRequest().operator);

/** JWT "typ" for console sign-ins, so customer app tokens and console tokens never stand in for each other. */
export const OPERATOR_TOKEN_TYPE = "operator";

/**
 * Console sign-in: "Authorization: Bearer <operator token>" from POST /admin/auth/login.
 * Scripts and tests may instead send the shared x-admin-key, which acts as an admin.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const key = String(req.headers["x-admin-key"] ?? "");
    if (key) {
      const a = Buffer.from(key);
      const b = Buffer.from(config.adminApiKey);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException("Admin key required");
      req.operator = { id: "admin-key", email: "admin-key", role: "admin", orgId: null } satisfies OperatorPrincipal;
      return true;
    }

    const [scheme, token] = String(req.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException("Sign in to the console");
    let payload: { sub: string; ver: number; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException("Your console session has ended. Sign in again");
    }
    if (payload.typ !== OPERATOR_TOKEN_TYPE) throw new UnauthorizedException("Sign in to the console");
    const user = await this.db.operatorUser.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active || user.tokenVersion !== payload.ver) throw new UnauthorizedException("Your console session has ended. Sign in again");

    const role = (OPERATOR_ROLES as readonly string[]).includes(user.role) ? (user.role as OperatorRole) : null;
    if (!role) throw new ForbiddenException("Your account has no console role");
    req.operator = { id: user.id, email: user.email, role, orgId: user.orgId } satisfies OperatorPrincipal;

    const targets = [ctx.getHandler(), ctx.getClass()];
    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>("allowBeforePasswordChange", targets)) {
      throw new ForbiddenException("Change your temporary password first");
    }
    const allowed = this.reflector.getAllAndOverride<OperatorRole[]>("operatorRoles", targets) ?? ["admin"];
    if (!allowed.includes(role)) throw new ForbiddenException("Your role cannot do this");
    return true;
  }
}
