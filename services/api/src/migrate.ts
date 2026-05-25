import { closeDatabase, runMigrations } from "./db";

async function main() {
  await runMigrations();
  await closeDatabase();
  console.log("Migrations complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
