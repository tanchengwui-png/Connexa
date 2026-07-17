export const registerTrust = ["Secure Billplz checkout", "Instant activation after payment", "Cancel anytime"] as const;

export const publicPackages = {
  starter: {
    code: "starter",
    name: "Starter",
    price: "RM79/mo",
    priceAmount: 79,
    currency: "MYR",
    billingPeriod: "MONTHLY",
    summary: "Best for smaller teams getting their first shared WhatsApp workspace live.",
    cta: "Create Starter workspace",
    featured: false,
    limits: {
      mediaLibraryStorageLimitBytes: null,
      maxOutboundMessages: 1000,
      maxActiveContacts: 500,
      maxActiveAutomations: 3,
      maxWhatsAppCampaigns: 10
    },
    highlights: ["1 manager workspace", "Shared inbox basics", "Fast onboarding"] as [
      string,
      string,
      string
    ],
    features: ["1 shared inbox", "Basic assignments", "Contact tags", "Quick replies"]
  },
  professional: {
    code: "professional",
    name: "Professional",
    price: "RM119/mo",
    priceAmount: 119,
    currency: "MYR",
    billingPeriod: "MONTHLY",
    summary: "Best for teams that need stronger coordination and cleaner daily operating flow.",
    cta: "Create Professional workspace",
    featured: false,
    limits: {
      mediaLibraryStorageLimitBytes: null,
      maxOutboundMessages: 5000,
      maxActiveContacts: 2000,
      maxActiveAutomations: 10,
      maxWhatsAppCampaigns: 50
    },
    highlights: ["More team seats", "Stronger handoff flow", "Daily operator ready"] as [
      string,
      string,
      string
    ],
    features: ["Everything in Starter", "More workspace seats", "Team notes", "Shared follow-up flow"]
  },
  growth: {
    code: "growth",
    name: "Growth",
    price: "RM149/mo",
    priceAmount: 149,
    currency: "MYR",
    billingPeriod: "MONTHLY",
    summary: "Best for active teams that need assignment, follow-up, and visibility at scale.",
    cta: "Create Growth workspace",
    featured: true,
    limits: {
      mediaLibraryStorageLimitBytes: null,
      maxOutboundMessages: 15000,
      maxActiveContacts: 5000,
      maxActiveAutomations: 25,
      maxWhatsAppCampaigns: 200
    },
    highlights: ["Lead follow-up ready", "Multi-agent workflow", "Operational visibility"] as [
      string,
      string,
      string
    ],
    features: ["Everything in Professional", "Automations", "Hot lead indicators", "Operational dashboards"]
  },
  enterprise: {
    code: "enterprise",
    name: "Enterprise",
    price: "Custom",
    priceAmount: null,
    currency: null,
    billingPeriod: null,
    summary: "Best for larger rollouts that need flexible setup, support, and enterprise-fit controls.",
    cta: "Create Enterprise workspace",
    featured: false,
    limits: {
      mediaLibraryStorageLimitBytes: null,
      maxOutboundMessages: null,
      maxActiveContacts: null,
      maxActiveAutomations: null,
      maxWhatsAppCampaigns: null
    },
    highlights: ["Flexible rollout", "Enterprise-fit controls", "Scale-ready onboarding"] as [
      string,
      string,
      string
    ],
    features: ["Everything in Growth", "Advanced roles", "Rollout support", "Priority support"]
  }
} satisfies Record<
  string,
  {
    code: string;
    name: string;
    price: string;
    priceAmount: number | null;
    currency: string | null;
    billingPeriod: "MONTHLY" | "YEARLY" | null;
    summary: string;
    cta: string;
    featured: boolean;
    limits: {
      mediaLibraryStorageLimitBytes: number | null;
      maxOutboundMessages: number | null;
      maxActiveContacts: number | null;
      maxActiveAutomations: number | null;
      maxWhatsAppCampaigns: number | null;
    };
    highlights: [string, string, string];
    features: string[];
  }
>;

export type PublicPackageKey = keyof typeof publicPackages;
export const defaultVisiblePublicPackageKeys: PublicPackageKey[] = ["starter", "professional", "growth"];
export const publicPackageKeys = Object.keys(publicPackages) as PublicPackageKey[];

export function isPublicPackageKey(value: string | null | undefined): value is PublicPackageKey {
  return Boolean(value && value in publicPackages);
}

export function getPublicPackageDefinition(packageKey: PublicPackageKey) {
  return publicPackages[packageKey];
}
