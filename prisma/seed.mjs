import { reseedDemoDatabase } from "./reseed-demo.mjs";

reseedDemoDatabase().catch((error) => {
  console.error(error);
  process.exit(1);
});
