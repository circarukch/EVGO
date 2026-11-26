import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from "@nestjs/common";
import { AdminGuard, AllowBeforePasswordChange, CurrentOperator, OperatorPrincipal, OperatorRoles } from "../admin/admin.guard";
import { NewOperator, OperatorsService } from "./operators.service";

/** Console sign-in. */
@Controller("admin/auth")
export class OperatorAuthController {
  constructor(private readonly ops: OperatorsService) {}

  @Post("login")
  @HttpCode(200)
  login(@Body() body: { email?: string; password?: string }) {
    return this.ops.login(body?.email, body?.password);
  }

  @Get("me")
  @UseGuards(AdminGuard)
  @OperatorRoles("admin", "station_operator")
  @AllowBeforePasswordChange()
  me(@CurrentOperator() op: OperatorPrincipal) {
    return this.ops.me(op);
  }

  @Post("password")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @OperatorRoles("admin", "station_operator")
  @AllowBeforePasswordChange()
  changePassword(@CurrentOperator() op: OperatorPrincipal, @Body() body: { currentPassword?: string; newPassword?: string }) {
    return this.ops.changePassword(op, body?.currentPassword, body?.newPassword);
  }
}

/** Admins add and manage console users. */
@Controller("admin/console-users")
@UseGuards(AdminGuard)
export class ConsoleUsersController {
  constructor(private readonly ops: OperatorsService) {}

  @Get()
  list() {
    return this.ops.list();
  }

  @Post()
  create(@Body() body: NewOperator) {
    return this.ops.create(body);
  }

  @Put(":id")
  update(@CurrentOperator() op: OperatorPrincipal, @Param("id") id: string, @Body() body: { name?: string; role?: string; orgId?: string; active?: boolean }) {
    return this.ops.update(op, id, body ?? {});
  }

  @Post(":id/reset-password")
  @HttpCode(200)
  reset(@Param("id") id: string) {
    return this.ops.resetPassword(id);
  }
}
