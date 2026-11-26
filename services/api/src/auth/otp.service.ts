import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeIndianMobile } from "./phone";
import { SMS_SENDER, SmsSender } from "./sms";

@Injectable()
export class OtpService {
  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  private hash(phone: string, code: string): string {
    return createHmac("sha256", config.jwtSecret).update(`${phone}:${code}`).digest("hex");
  }

  private phoneOrThrow(raw: string): string {
    const phone = normalizeIndianMobile(raw);
    if (!phone) throw new BadRequestException("Enter a valid 10-digit Indian mobile number");
    return phone;
  }

  async request(rawPhone: string) {
    const phone = this.phoneOrThrow(rawPhone);
    const now = Date.now();
    const recent = await this.db.otpChallenge.findMany({
      where: { phone, createdAt: { gte: new Date(now - 3_600_000) } },
      orderBy: { createdAt: "desc" },
    });
    if (recent[0] && now - recent[0].createdAt.getTime() < config.otpResendSec * 1000) {
      throw new HttpException(`Wait ${config.otpResendSec} seconds before requesting another code`, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (recent.length >= config.otpMaxPerHour) {
      throw new HttpException("Too many codes requested. Try again in an hour", HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.db.otpChallenge.create({
      data: { phone, codeHash: this.hash(phone, code), expiresAt: new Date(now + config.otpTtlSec * 1000) },
    });
    await this.sms.send(phone, `${code} is your EVGO login code. It expires in 5 minutes. Do not share it.`);
    return { phone, expiresInSec: config.otpTtlSec, ...(config.otpDevEcho ? { devCode: code } : {}) };
  }

  async verify(rawPhone: string, code: string) {
    const phone = this.phoneOrThrow(rawPhone);
    if (!/^\d{6}$/.test(code ?? "")) throw new BadRequestException("Code must be 6 digits");
    const challenge = await this.db.otpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge) throw new UnauthorizedException("Code expired. Request a new one");
    if (challenge.attempts >= config.otpMaxAttempts) {
      throw new UnauthorizedException("Too many wrong attempts. Request a new code");
    }
    await this.db.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    const ok = timingSafeEqual(Buffer.from(challenge.codeHash, "hex"), Buffer.from(this.hash(phone, code), "hex"));
    if (!ok) throw new UnauthorizedException("Wrong code");

    // Consume once: a parallel verify with the same code loses here.
    const consumed = await this.db.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new UnauthorizedException("Code already used");

    const user = await this.db.user.upsert({ where: { phone }, update: {}, create: { phone } });
    await this.db.walletAccount.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return { accessToken, user: { id: user.id, phone: user.phone, name: user.name } };
  }
}
