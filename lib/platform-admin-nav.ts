export function getPlatformAdminNavItems() {
  return [
    {
      key: "email",
      title: "Email & SMTP",
      description: "Delivery server, sender identity, and test email controls.",
      href: "/platform",
      status: "live" as const
    },
    {
      key: "packages",
      title: "Packages",
      description: "Choose which public packages are shown before signup.",
      href: "/platform/packages",
      status: "live" as const
    },
    {
      key: "discounts",
      title: "Discounts",
      description: "Generate and manage discount codes for package checkout.",
      href: "/platform/discounts",
      status: "live" as const
    },
    {
      key: "whatsapp",
      title: "WhatsApp ops",
      description: "Connection health, import stability, worker state, and live traffic proof across workspaces.",
      href: "/platform/whatsapp",
      status: "live" as const
    },
    {
      key: "branding",
      title: "Brand & identity",
      description: "Shared logos, signatures, and outbound brand defaults.",
      status: "planned" as const
    },
    {
      key: "security",
      title: "Security",
      description: "Platform-level admin access, audit controls, and hardening.",
      status: "planned" as const
    },
    {
      key: "integrations",
      title: "Integrations",
      description: "Future vendor credentials and platform-wide connection settings.",
      status: "planned" as const
    }
  ];
}
