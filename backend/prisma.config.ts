// Prisma 7 no longer reads the datasource URL from schema.prisma or loads .env
// on its own. dotenv never overrides a variable that is already set, so the
// compose env, CI env and the integration suite's DATABASE_URL still win.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // process.env, not env(): env() throws when unset, and `prisma generate`
  // (CI, Dockerfile) runs with no database configured.
  datasource: { url: process.env.DATABASE_URL ?? '' }
});
