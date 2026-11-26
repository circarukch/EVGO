import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthUser, CurrentUser } from "../auth/auth.guard";
import { WalletService } from "./wallet.service";

@Controller("wallet")
@UseGuards(AuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.wallet.summary(user.id);
  }

  @Post("topups")
  topUp(@CurrentUser() user: AuthUser, @Body() body: { amountPaise: number }) {
    return this.wallet.createTopUp(user.id, body?.amountPaise);
  }

  @Post("topups/:id/mock-confirm")
  mockConfirm(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.wallet.mockConfirm(user.id, id);
  }
}
