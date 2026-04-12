import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { LeadRecordForm } from "@/components/lead-record-form";
import { getLeadRecord } from "@/lib/leads";
import { listProducts } from "@/lib/products";

type LeadRecordPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function LeadRecordPage({ params }: LeadRecordPageProps) {
  const { id } = await params;
  const [lead, products] = await Promise.all([getLeadRecord(id), listProducts()]);

  if (!lead) {
    notFound();
  }

  return (
    <DashboardShell currentPath="/leads">
      <section className="hero">
        <div>
          <span className="badge">Lead record</span>
          <h2>Manage the opportunity outside the inbox.</h2>
          <p className="muted">
            Use this record for qualification, next actions, and property linkage. The inbox stays
            focused on queue handling and fast replies.
          </p>
        </div>
      </section>

      <LeadRecordForm
        lead={{
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          project: lead.project,
          stage: lead.stage,
          priority: lead.priority,
          preferredArea: lead.preferredArea,
          budget: lead.budget,
          financingStatus: lead.financingStatus,
          nextActionAtIso: lead.nextActionAt ? lead.nextActionAt.toISOString() : null,
          sourceDetail: lead.sourceDetail,
          owner: lead.owner?.name ?? null,
          images: parseImageUrls(lead.customData),
          productId: lead.productId ?? null
        }}
        products={products}
      />
    </DashboardShell>
  );
}

function parseImageUrls(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const payload = JSON.parse(value) as { imageUrls?: unknown };
    if (!Array.isArray(payload.imageUrls)) {
      return [];
    }

    return payload.imageUrls.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}
