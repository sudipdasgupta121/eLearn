// Refuses to run a performance test against anything that could be the app's real database.
// Compares NORMALISED identities (host+port+database), not raw strings, so a pooled vs direct
// endpoint or a different query string can't slip past a textual comparison.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function dbIdentity(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("The test database URL is not a valid connection string.");
  }
  // Neon (and similar) expose the same database via "<endpoint>" and "<endpoint>-pooler".
  const host = u.hostname.toLowerCase().replace(/-pooler(?=\.)/, "");
  return `${host}:${u.port || "default"}/${u.pathname.replace(/^\//, "")}`;
}

function fromEnvFile(file, names) {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf-8");
  return names.map((n) => text.match(new RegExp(`^${n}=(.*)$`, "m"))?.[1]?.trim()).filter(Boolean);
}

// Every place the app's real URL could live: its own .env, and this shell's environment.
export function realDatabaseUrls(appRoot, names = ["DATABASE_URL"]) {
  return [
    ...fromEnvFile(path.join(appRoot, ".env"), names),
    ...fromEnvFile(path.join(appRoot, "server", ".env"), names), // upSkill keeps its real URL here
    ...names.map((n) => process.env[n]).filter(Boolean),
  ];
}

export function assertSafeTestDatabase(testUrl, appRoot, names) {
  if (!testUrl || !testUrl.trim()) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Performance runs require a dedicated test database that the " +
        "user supplies for EVERY run (pass it inline: TEST_DATABASE_URL=... npm run perf)."
    );
  }
  const id = dbIdentity(testUrl);
  for (const real of realDatabaseUrls(appRoot, names)) {
    if (real === testUrl || dbIdentity(real) === id) {
      throw new Error(
        `Refusing to run: the test database (${id}) is the app's real database. ` +
          "Use a separate database/branch for performance tests."
      );
    }
  }
  return id;
}
