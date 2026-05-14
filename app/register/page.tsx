import { redirect } from "next/navigation";
import { getAgentEntryPath } from "@/lib/auth/entry-path";
import { getCurrentAgent } from "@/lib/auth/current-user";
import { isPublicPackageKey } from "@/lib/public-packages";

export default async function RegisterPage({
  searchParams
}: {
  searchParams?: Promise<{ plan?: string }>;
}) {
  const agent = await getCurrentAgent();
  const resolvedSearchParams = await searchParams;

  if (agent) {
    redirect(await getAgentEntryPath(agent));
  }

  const selectedPlanKey = resolvedSearchParams?.plan;
  if (!isPublicPackageKey(selectedPlanKey)) {
    redirect("/packages");
  }
  redirect(`/checkout?plan=${selectedPlanKey}`);
}
