import { execSync } from "node:child_process";

// Apply migrations and reload seed data (the seed clears old rows) once per test run.
export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://evgo:evgo_dev_only@localhost:5432/evgo_test";
  const env = { ...process.env, DATABASE_URL: url };
  execSync("pnpm exec prisma migrate deploy", { env, stdio: "ignore" });
  execSync("pnpm exec tsx prisma/seed.ts", { env, stdio: "ignore" });
}
