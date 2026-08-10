import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://gridproof:gridproof@localhost:5432/gridproof";
const migrationsDir = path.resolve("infrastructure/migrations");

const pool = new Pool({ connectionString: databaseUrl });

async function main() {
  try {
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      await pool.query(sql);
      console.log(`applied ${file}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
