import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { OperatorUser } from "@prisma/client";
import { OPERATOR_ROLES, OPERATOR_TOKEN_TYPE, OperatorPrincipal, OperatorRole } from "../admin/admin.guard";
import { checkPassword, hashPassword, randomPassword } from "../common/password";
import { PrismaService } from "../prisma/prisma.service";

export const MIN_PASSWORD = 10;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
/** A console sign-in lasts one working day. */
const SESSION = "12h";

export interface NewOperator {
  email?: string;
  name?: string;
  role?: string;
  orgId?: string;
}

const normEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : "");

/** Console users: sign-in, password changes, and (for admins) adding and managing other users. */
@Injectable()
export class OperatorsService {
  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  view(u: OperatorUser & { org?: { name: string } | null }) {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      orgId: u.orgId,
      orgName: u.org?.name ?? null,
      active: u.active,
      mustChangePassword: u.mustChangePassword,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    };
  }

  private token(u: OperatorUser) {
    return this.jwt.signAsync({ sub: u.id, ver: u.tokenVersion, typ: OPERATOR_TOKEN_TYPE }, { expiresIn: SESSION });
  }

  async login(emailIn: unknown, password: unknown) {
    const email = normEmail(emailIn);
    const wrong = new UnauthorizedException("Wrong email or password");
    if (!email || typeof password !== "string" || !password) throw wrong;
    const u = await this.db.operatorUser.findUnique({ where: { email }, include: { org: true } });
    if (!u || !u.active) {
      checkPassword(password, "scrypt:c2FsdA==:aGFzaA=="); // same work as a real check, so timing does not reveal which emails exist
      throw wrong;
    }
    if (u.lockedUntil && u.lockedUntil > new Date()) {
      throw new UnauthorizedException(`Too many wrong passwords. Try again after ${LOCK_MINUTES} minutes, or ask an admin to reset it`);
    }
    if (!checkPassword(password, u.passwordHash)) {
      const failed = u.failedLogins + 1;
      await this.db.operatorUser.update({
        where: { id: u.id },
        data: failed >= MAX_FAILED ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLogins: failed },
      });
      throw wrong;
    }
    const updated = await this.db.operatorUser.update({
      where: { id: u.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
      include: { org: true },
    });
    return { token: await this.token(updated), operator: this.view(updated) };
  }

  async me(p: OperatorPrincipal) {
    if (p.id === "admin-key") return { id: p.id, email: p.email, name: "Admin key", role: "admin", orgId: null, orgName: null, active: true, mustChangePassword: false };
    const u = await this.db.operatorUser.findUnique({ where: { id: p.id }, include: { org: true } });
    if (!u) throw new NotFoundException("Account not found");
    return this.view(u);
  }

  /** Change your own password. Every other sign-in of yours ends; you get a fresh token. */
  async changePassword(p: OperatorPrincipal, current: unknown, next: unknown) {
    const u = await this.db.operatorUser.findUnique({ where: { id: p.id } });
    if (!u) throw new ForbiddenException("Only console users have a password");
    if (typeof current !== "string" || !checkPassword(current, u.passwordHash)) throw new BadRequestException("Your current password is wrong");
    const pw = this.checkNew(next);
    if (pw === current) throw new BadRequestException("Choose a password different from the current one");
    const updated = await this.db.operatorUser.update({
      where: { id: u.id },
      data: { passwordHash: hashPassword(pw), mustChangePassword: false, tokenVersion: { increment: 1 } },
      include: { org: true },
    });
    return { token: await this.token(updated), operator: this.view(updated) };
  }

  private checkNew(next: unknown): string {
    if (typeof next !== "string" || next.length < MIN_PASSWORD) throw new BadRequestException(`Use at least ${MIN_PASSWORD} characters`);
    if (next.length > 200) throw new BadRequestException("That password is too long");
    return next;
  }

  // --- Admins managing console users ---

  async list() {
    const rows = await this.db.operatorUser.findMany({ include: { org: true }, orderBy: [{ active: "desc" }, { email: "asc" }] });
    return rows.map((u) => this.view(u));
  }

  /** Adds a console user with a temporary password, shown this once. They must change it at first sign-in. */
  async create(body: NewOperator) {
    const email = normEmail(body?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException("Enter a valid email address");
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (name.length < 2) throw new BadRequestException("Enter the person's name");
    const role = this.role(body?.role);
    const orgId = await this.org(role, body?.orgId);
    if (await this.db.operatorUser.findUnique({ where: { email } })) throw new ConflictException("Someone already uses that email");
    const temporaryPassword = randomPassword(14);
    const u = await this.db.operatorUser.create({
      data: { email, name, role, orgId, passwordHash: hashPassword(temporaryPassword), mustChangePassword: true },
      include: { org: true },
    });
    return { operator: this.view(u), temporaryPassword };
  }

  async update(actor: OperatorPrincipal, id: string, body: { name?: string; role?: string; orgId?: string; active?: boolean }) {
    const u = await this.db.operatorUser.findUnique({ where: { id } });
    if (!u) throw new NotFoundException("Console user not found");
    if (id === actor.id && (body.active === false || (body.role && body.role !== u.role))) {
      throw new BadRequestException("You cannot switch off or change the role of your own account");
    }
    const data: { name?: string; role?: string; orgId?: string; active?: boolean; tokenVersion?: { increment: number } } = {};
    if (body.name !== undefined) {
      const n = String(body.name).trim().slice(0, 80);
      if (n.length < 2) throw new BadRequestException("Enter the person's name");
      data.name = n;
    }
    const role = body.role !== undefined ? this.role(body.role) : (u.role as OperatorRole);
    if (body.role !== undefined || body.orgId !== undefined) {
      data.role = role;
      data.orgId = await this.org(role, body.orgId ?? u.orgId);
      data.tokenVersion = { increment: 1 };
    }
    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") throw new BadRequestException("active must be true or false");
      data.active = body.active;
      if (!body.active) data.tokenVersion = { increment: 1 };
    }
    if (u.role === "admin" && (data.active === false || (data.role && data.role !== "admin"))) await this.keepOneAdmin(id);
    const updated = await this.db.operatorUser.update({ where: { id }, data, include: { org: true } });
    return this.view(updated);
  }

  /** New temporary password; their current sign-ins end and they must change it at next sign-in. */
  async resetPassword(id: string) {
    const u = await this.db.operatorUser.findUnique({ where: { id } });
    if (!u) throw new NotFoundException("Console user not found");
    const temporaryPassword = randomPassword(14);
    const updated = await this.db.operatorUser.update({
      where: { id },
      data: { passwordHash: hashPassword(temporaryPassword), mustChangePassword: true, tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null },
      include: { org: true },
    });
    return { operator: this.view(updated), temporaryPassword };
  }

  private role(r: unknown): OperatorRole {
    if (!(OPERATOR_ROLES as readonly string[]).includes(String(r))) throw new BadRequestException("Role must be admin or station_operator");
    return r as OperatorRole;
  }

  /** Admins belong to the EVGO platform organisation; station operators to a charging operator (CPO). */
  private async org(role: OperatorRole, orgId: unknown): Promise<string> {
    if (role === "admin") {
      const platform = await this.db.organisation.findFirst({ where: { kinds: { has: "PLATFORM" } }, orderBy: { name: "asc" } });
      if (!platform) throw new BadRequestException("No platform organisation set up");
      return platform.id;
    }
    const org = typeof orgId === "string" && orgId ? await this.db.organisation.findUnique({ where: { id: orgId } }) : null;
    if (!org || !org.kinds.includes("CPO")) throw new BadRequestException("Choose the charging operator this person works for");
    return org.id;
  }

  private async keepOneAdmin(leaving: string) {
    const others = await this.db.operatorUser.count({ where: { role: "admin", active: true, id: { not: leaving } } });
    if (others === 0) throw new BadRequestException("Keep at least one active admin");
  }
}
