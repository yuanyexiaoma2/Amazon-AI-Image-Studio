import { prisma } from './client.js';
import { newId } from './ids.js';

async function main() {
  console.log('Seed placeholder — create users via /register in MVP.');
  // Keep seed idempotent / empty for W1; demo seed comes later.
  void newId;
  await prisma.$connect();
  console.log('DB connected OK');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
