export const metrics = [
  { label: "New leads today", value: "38", detail: "+12% vs yesterday" },
  { label: "Booked site visits", value: "11", detail: "6 scheduled in the next 24h" },
  { label: "Response under 5 min", value: "82%", detail: "Target: 85%" },
  { label: "Active agents", value: "14", detail: "2 need follow-up prompts" }
];

export const pipeline = [
  {
    name: "New lead",
    count: 22,
    summary: "Fresh inbound leads from Meta ads, PropertyGuru, and QR codes."
  },
  {
    name: "Qualified",
    count: 17,
    summary: "Budget, area, and financing status already captured by the bot."
  },
  {
    name: "Follow-up risk",
    count: 6,
    summary: "Leads with no agent reply in the last 8 hours."
  }
];

export const sourceMix = [
  { source: "Meta ads", share: 48 },
  { source: "Property portals", share: 28 },
  { source: "Website chat", share: 16 },
  { source: "Referral QR", share: 8 }
];

export const hotLeads = [
  {
    name: "Aina Rahman",
    stage: "Qualified",
    project: "Serene Duta Residences",
    signal: "Budget RM650k, viewing requested for Saturday",
    owner: "Farid"
  },
  {
    name: "Jason Tan",
    stage: "New lead",
    project: "Skylane @ PJ Sentral",
    signal: "Asked for car park availability and financing support",
    owner: "Round robin"
  },
  {
    name: "Nurin Ahmad",
    stage: "Follow-up",
    project: "Bayside Suites",
    signal: "No reply after brochure was sent 9 hours ago",
    owner: "Mei Ling"
  }
];

export const inbox = [
  {
    name: "Aina Rahman",
    lastMessage: "Can we view the corner unit this Saturday morning?",
    channel: "WhatsApp",
    age: "2m ago"
  },
  {
    name: "Jason Tan",
    lastMessage: "What is the monthly installment if I put 10% down?",
    channel: "WhatsApp",
    age: "11m ago"
  },
  {
    name: "Mervyn Group Lead Form",
    lastMessage: "New portal lead captured for Sentul project.",
    channel: "Portal sync",
    age: "18m ago"
  }
];

export const teamBoard = [
  {
    agent: "Farid",
    openLeads: 12,
    bookedVisits: 4,
    responseTime: "3m 12s"
  },
  {
    agent: "Mei Ling",
    openLeads: 9,
    bookedVisits: 3,
    responseTime: "4m 05s"
  },
  {
    agent: "Hakim",
    openLeads: 14,
    bookedVisits: 2,
    responseTime: "8m 44s"
  }
];

export const timeline = [
  {
    title: "Lead auto-assigned to Jason Team",
    description: "PropertyGuru inquiry for Skylane @ PJ Sentral routed by area and budget rules.",
    time: "09:12"
  },
  {
    title: "Viewing reminder sent",
    description: "Automated WhatsApp reminder went out to 3 confirmed site visits for tomorrow.",
    time: "08:40"
  },
  {
    title: "Manager escalation triggered",
    description: "Hakim has 3 overdue leads with no follow-up inside the SLA window.",
    time: "08:10"
  }
];
