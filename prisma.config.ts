import "dotenv/config";
import { defineConfig } from "prisma/config";

const DEFAULT_DATABASE_URL = "postgresql://build:build@127.0.0.1:5432/connexa_build?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL
  }
});
