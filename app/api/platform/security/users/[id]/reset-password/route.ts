import { handlePlatformUserResetPasswordRequest } from "@/lib/platform-security-route-handlers";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  return handlePlatformUserResetPasswordRequest(params.id);
}
