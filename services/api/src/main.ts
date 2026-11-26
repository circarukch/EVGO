import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true }); // raw body: payment webhooks are signed over it
  app.setGlobalPrefix("v1");
  app.enableCors();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`EVGO API on http://localhost:${port}/v1`);
}
bootstrap();
