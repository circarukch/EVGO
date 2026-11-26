import { Module } from "@nestjs/common";
import { ConsoleUsersController, OperatorAuthController } from "./operators.controller";
import { OperatorsService } from "./operators.service";

@Module({
  controllers: [OperatorAuthController, ConsoleUsersController],
  providers: [OperatorsService],
})
export class OperatorsModule {}
