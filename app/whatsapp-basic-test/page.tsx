import { BasicWhatsAppQrTest } from "@/components/basic-whatsapp-qr-test";
import { requireManager } from "@/lib/auth/current-user";
import { startBasicWhatsAppQrTest } from "@/lib/basic-whatsapp-qr-test";

export const dynamic = "force-dynamic";

export default async function WhatsAppBasicTestPage() {
  const manager = await requireManager();
  const initialStatus = startBasicWhatsAppQrTest(manager.workspaceId);
  return <BasicWhatsAppQrTest initialStatus={initialStatus} />;
}
