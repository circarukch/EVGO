// Creates the first console admin on a new server (or another admin later).
// Usage: pnpm --filter @evgo/api operator:create <email> "<name>"
// Prints a temporary password once; the person must change it at first sign-in.
import { PrismaClient } from "@prisma/client";
import { hashPassword, randomPassword } from "../src/common/password";

async function main() {
  const [emailArg, ...nameParts] = process.argv.slice(2);
  const email = (emailArg ?? "").trim().toLowerCase();
  const name = nameParts.join(" ").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || name.length < 2) {
    console.error('Usage: operator:create <email> "<name>"');
    process.exit(1);
  }
  const db = new PrismaClient();
  try {
    const platform =
      (await db.organisation.findFirst({ where: { kinds: { has: "PLATFORM" } } })) ??
      (await db.organisation.create({ data: { id: "org-evgo", name: "EVGO", kinds: ["PLATFORM", "CPO", "BUS_OPERATOR"] } }));
    if (await db.operatorUser.findUnique({ where: { email } })) {
      console.error(`${email} already has a console account. Reset its password from the console instead.`);
      process.exit(1);
    }
    const password = randomPassword(14);
    await db.operatorUser.create({ data: { email, name, role: "admin", orgId: platform.id, passwordHash: hashPassword(password), mustChangePassword: true } });
    console.log(`Admin ${email} created.\nTemporary password (shown once): ${password}\nSign in to the console and choose a new password.`);
  } finally {
    await db.$disconnect();
  }
}

main();
