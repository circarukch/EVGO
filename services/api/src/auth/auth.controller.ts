import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthGuard, AuthUser, CurrentUser } from "./auth.guard";
import { OtpService } from "./otp.service";

@Controller()
export class AuthController {
  constructor(private readonly otp: OtpService, private readonly db: PrismaService) {}

  @Post("auth/otp/request")
  @HttpCode(200)
  request(@Body() body: { phone: string }) {
    return this.otp.request(body?.phone);
  }

  @Post("auth/otp/verify")
  @HttpCode(200)
  verify(@Body() body: { phone: string; code: string }) {
    return this.otp.verify(body?.phone, body?.code);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.db.user.findUniqueOrThrow({ where: { id: user.id } });
    return { id: u.id, phone: u.phone, name: u.name };
  }
}
