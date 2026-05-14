declare module "../../../../../prisma/reseed-demo.mjs" {
  export function reseedDemoDatabase(): Promise<void>;
}

declare module "../../../../../prisma/bootstrap-platform-shared.mjs" {
  export function bootstrapPlatformAdmin(): Promise<void>;
}
