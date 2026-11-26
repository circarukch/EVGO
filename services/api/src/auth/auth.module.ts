import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { config } from "../config";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { OtpService } from "./otp.service";
import { ConsoleSmsSender, SMS_SENDER } from "./sms";

@Global()
@Module({
  imports: [JwtModule.register({ secret: config.jwtSecret, signOptions: { expiresIn: "30d" } })],
  controllers: [AuthController],
  providers: [OtpService, AuthGuard, { provide: SMS_SENDER, useClass: ConsoleSmsSender }],
  exports: [AuthGuard, JwtModule],
})
export class AuthModule {}
