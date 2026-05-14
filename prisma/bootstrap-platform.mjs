import { bootstrapPlatformAdmin } from "./bootstrap-platform-shared.mjs";

bootstrapPlatformAdmin().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
