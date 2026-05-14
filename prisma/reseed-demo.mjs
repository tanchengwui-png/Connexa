import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import prismaPackage from "@prisma/client";

const {
  PrismaClient,
  AgentRole,
  AgentStatus,
  ContactStatus,
  ConversationStatus,
  IndustryType,
  LeadPriority,
  LeadSource,
  LeadStage,
  MessageDirection
} = prismaPackage;

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://connexa:connexa@localhost:5432/connexa?schema=public"
  });

  return new PrismaClient({ adapter });
}

function getDatabaseTarget() {
  const url = process.env.DATABASE_URL ?? "postgresql://connexa:connexa@localhost:5432/connexa?schema=public";

  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port || (parsed.protocol === "postgresql:" ? "5432" : ""),
      database: parsed.pathname.replace(/^\//, "") || null
    };
  } catch {
    return {
      host: null,
      port: null,
      database: null
    };
  }
}

async function collectResetCounts(prisma) {
  const [workspaces, agents, contacts, conversations, messages, rules, workflows, jobs, automationStates] =
    await Promise.all([
      prisma.workspace.count(),
      prisma.agent.count(),
      prisma.contact.count(),
      prisma.conversation.count(),
      prisma.message.count(),
      prisma.automationRule.count(),
      prisma.automationWorkflow.count(),
      prisma.automationJob.count(),
      prisma.conversationAutomationState.count()
    ]);

  return {
    workspaces,
    agents,
    contacts,
    conversations,
    messages,
    rules,
    workflows,
    jobs,
    automationStates
  };
}

export async function reseedDemoDatabase() {
  const prisma = createPrismaClient();
  const now = new Date();
  const hoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000);
  const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  try {
    if (prisma.invite) {
      await prisma.invite.deleteMany();
    }
    if (prisma.emailVerificationToken) {
      await prisma.emailVerificationToken.deleteMany();
    }
    if (prisma.session) {
      await prisma.session.deleteMany();
    }
    await prisma.outboundMessageJob.deleteMany();
    await prisma.automationJob.deleteMany();
    await prisma.conversationRuleExecution.deleteMany();
    await prisma.conversationAutomationState.deleteMany();
    await prisma.outboundWorkerHeartbeat.deleteMany();
    await prisma.appointment.deleteMany();
    await prisma.message.deleteMany();
    await prisma.note.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.workspaceAutomationSettings.deleteMany();
    await prisma.automationWorkflow.deleteMany();
    await prisma.automationRule.deleteMany();
    await prisma.whatsAppChannel.deleteMany();
    await prisma.quickReply.deleteMany();
    await prisma.lead.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.product.deleteMany();
    await prisma.agentAvailabilityOverride.deleteMany();
    await prisma.agentAvailabilityRule.deleteMany();
    await prisma.agent.deleteMany();
    if (prisma.account) {
      await prisma.account.deleteMany();
    }
    await prisma.workspace.deleteMany();

    const workspace = await prisma.workspace.create({
      data: {
        name: "Serene Peak Realty",
        slug: "serene-peak-realty",
        industryType: IndustryType.PROPERTY,
        plan: "trial",
        trialEndsAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
      }
    });

    const accounts = prisma.account
      ? await prisma.$transaction([
          prisma.account.create({
            data: {
              email: "farid@connexa.local",
              passwordHash: hashPassword("Passw0rd!"),
              emailVerifiedAt: now,
              lastLoginAt: hoursAgo(2)
            }
          }),
          prisma.account.create({
            data: {
              email: "meiling@connexa.local",
              passwordHash: hashPassword("Passw0rd!"),
              emailVerifiedAt: now,
              lastLoginAt: hoursAgo(4)
            }
          }),
          prisma.account.create({
            data: {
              email: "hakim@connexa.local",
              passwordHash: hashPassword("Passw0rd!"),
              emailVerifiedAt: now,
              lastLoginAt: daysAgo(1)
            }
          }),
          prisma.account.create({
            data: {
              email: "aisyah@connexa.local",
              passwordHash: hashPassword("Passw0rd!"),
              emailVerifiedAt: now,
              lastLoginAt: daysAgo(2)
            }
          })
        ])
      : [null, null, null, null];

    const agents = await prisma.$transaction([
      prisma.agent.create({
        data: {
          accountId: accounts[0]?.id,
          workspaceId: workspace.id,
          name: "Farid",
          email: "farid@connexa.local",
          passwordHash: hashPassword("Passw0rd!"),
          emailVerifiedAt: now,
          lastLoginAt: hoursAgo(2),
          inviteAcceptedAt: now,
          phone: "+60120000001",
          role: AgentRole.MANAGER,
          status: AgentStatus.ACTIVE
        }
      }),
      prisma.agent.create({
        data: {
          accountId: accounts[1]?.id,
          workspaceId: workspace.id,
          name: "Mei Ling",
          email: "meiling@connexa.local",
          passwordHash: hashPassword("Passw0rd!"),
          emailVerifiedAt: now,
          lastLoginAt: hoursAgo(4),
          inviteAcceptedAt: now,
          phone: "+60120000002",
          role: AgentRole.AGENT,
          status: AgentStatus.ACTIVE
        }
      }),
      prisma.agent.create({
        data: {
          accountId: accounts[2]?.id,
          workspaceId: workspace.id,
          name: "Hakim",
          email: "hakim@connexa.local",
          passwordHash: hashPassword("Passw0rd!"),
          emailVerifiedAt: now,
          lastLoginAt: daysAgo(1),
          inviteAcceptedAt: now,
          phone: "+60120000003",
          role: AgentRole.AGENT,
          status: AgentStatus.ACTIVE
        }
      }),
      prisma.agent.create({
        data: {
          accountId: accounts[3]?.id,
          workspaceId: workspace.id,
          name: "Aisyah",
          email: "aisyah@connexa.local",
          passwordHash: hashPassword("Passw0rd!"),
          emailVerifiedAt: now,
          lastLoginAt: daysAgo(2),
          inviteAcceptedAt: now,
          phone: "+60120000004",
          role: AgentRole.AGENT,
          status: AgentStatus.AWAY
        }
      })
    ]);

    const contacts = await prisma.$transaction([
      prisma.contact.create({
        data: {
          workspaceId: workspace.id,
          displayName: "Sarah Lim",
          phone: "+60123000111",
          email: "sarah@example.com",
          status: ContactStatus.ACTIVE,
          isHotLead: true,
          tags: "buyer,vip,condo",
          lastInteractionAt: hoursAgo(1)
        }
      }),
      prisma.contact.create({
        data: {
          workspaceId: workspace.id,
          displayName: "Adrian Foo",
          phone: "+60123000112",
          status: ContactStatus.ACTIVE,
          isHotLead: false,
          tags: "support,tenant",
          lastInteractionAt: hoursAgo(4)
        }
      }),
      prisma.contact.create({
        data: {
          workspaceId: workspace.id,
          displayName: "Puan Nabila",
          phone: "+60123000113",
          status: ContactStatus.ACTIVE,
          isHotLead: true,
          tags: "buyer,landed",
          lastInteractionAt: hoursAgo(7)
        }
      })
    ]);

    const products = await prisma.$transaction([
      prisma.product.create({
        data: {
          workspaceId: workspace.id,
          name: "Serene Duta Residences",
          description: "Boutique high-rise with lush gardens in Mont Kiara.",
          area: "Mont Kiara",
          location: "Kuala Lumpur",
          financing: "Bank-assisted loans for eligible buyers. Developer rebate available on selected units.",
          financingTags: JSON.stringify(["BANK_LOAN", "DEVELOPER_REBATE"]),
          priceMin: 620000,
          priceMax: 780000,
          latitude: 3.153,
          longitude: 101.6169,
          imageUrls: JSON.stringify([
            "https://example.com/serene-duta/front.jpg",
            "https://example.com/serene-duta/pool.jpg"
          ])
        }
      }),
      prisma.product.create({
        data: {
          workspaceId: workspace.id,
          name: "Skylane @ PJ Sentral",
          description: "Transit-oriented residence near KL Sentral with flexible layouts.",
          area: "Petaling Jaya",
          location: "Kuala Lumpur",
          financing: "Flexible term loans with low booking fee campaigns on selected layouts.",
          financingTags: JSON.stringify(["FLEXI_LOAN", "LOW_BOOKING_FEE"]),
          priceMin: 500000,
          priceMax: 880000,
          latitude: 3.0779,
          longitude: 101.6764,
          imageUrls: JSON.stringify(["https://example.com/skylane/exterior.jpg"])
        }
      })
    ]);

    await prisma.lead.createMany({
      data: [
        {
          workspaceId: workspace.id,
          contactId: contacts[0].id,
          ownerId: agents[0].id,
          productId: products[0].id,
          name: "Aina Rahman",
          phone: "+60190010001",
          source: LeadSource.META_ADS,
          sourceDetail: "Meta lead form, campaign C-Residences-Q2",
          project: "Serene Duta Residences",
          stage: LeadStage.QUALIFIED,
          pipelineStageKey: "qualified",
          industryType: IndustryType.PROPERTY,
          priority: LeadPriority.HIGH,
          budget: 650000,
          preferredArea: "Mont Kiara",
          financingStatus: "Mortgage pre-check in progress",
          note: "Saturday morning viewing requested.",
          lastMessage: "Can we view the corner unit this Saturday morning?",
          responseMinutes: 3,
          nextActionAt: new Date(now.getTime() + 5 * 60 * 60 * 1000),
          lastActivityAt: hoursAgo(2),
          siteVisitAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          customData: JSON.stringify({
            unitType: "3BR corner",
            buyerType: "Own stay",
            decisionTimeline: "2 months"
          }),
          createdAt: hoursAgo(5)
        },
        {
          workspaceId: workspace.id,
          ownerId: agents[2].id,
          productId: products[1].id,
          name: "Jason Tan",
          phone: "+60190010002",
          source: LeadSource.PROPERTY_PORTAL,
          sourceDetail: "PropertyGuru premium listing",
          project: "Skylane @ PJ Sentral",
          stage: LeadStage.NEW_LEAD,
          pipelineStageKey: "new_lead",
          industryType: IndustryType.PROPERTY,
          priority: LeadPriority.MEDIUM,
          budget: 780000,
          preferredArea: "Petaling Jaya",
          financingStatus: "Needs financing guidance",
          note: "Interested in car park availability.",
          lastMessage: "What is the monthly installment if I put 10% down?",
          responseMinutes: 9,
          nextActionAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
          lastActivityAt: hoursAgo(1),
          customData: JSON.stringify({
            unitType: "2BR",
            buyerType: "Investment",
            carParksNeeded: 2
          }),
          createdAt: hoursAgo(1)
        },
        {
          workspaceId: workspace.id,
          contactId: contacts[1].id,
          ownerId: agents[1].id,
          productId: products[0].id,
          name: "Nurin Ahmad",
          phone: "+60190010003",
          source: LeadSource.WEBSITE_CHAT,
          sourceDetail: "Website WhatsApp widget",
          project: "Bayside Suites",
          stage: LeadStage.FOLLOW_UP,
          pipelineStageKey: "follow_up",
          industryType: IndustryType.PROPERTY,
          priority: LeadPriority.URGENT,
          budget: 520000,
          preferredArea: "Cyberjaya",
          financingStatus: "Cash + loan split",
          note: "Brochure sent, follow-up overdue.",
          lastMessage: "Thanks, I will check with my husband tonight.",
          responseMinutes: 4,
          nextActionAt: hoursAgo(1),
          lastActivityAt: hoursAgo(9),
          customData: JSON.stringify({
            unitType: "2BR",
            buyerType: "Own stay",
            decisionTimeline: "This month"
          }),
          createdAt: daysAgo(1)
        },
        {
          workspaceId: workspace.id,
          contactId: contacts[2].id,
          ownerId: agents[0].id,
          name: "Marcus Lee",
          phone: "+60190010004",
          source: LeadSource.META_ADS,
          sourceDetail: "Retargeting ad",
          project: "One Crown Residence",
          stage: LeadStage.SITE_VISIT_BOOKED,
          pipelineStageKey: "viewing_booked",
          industryType: IndustryType.PROPERTY,
          priority: LeadPriority.HIGH,
          budget: 920000,
          preferredArea: "Cheras",
          financingStatus: "Loan approved",
          note: "Viewing confirmed with spouse attending.",
          lastMessage: "See you tomorrow at 3pm.",
          responseMinutes: 2,
          nextActionAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
          lastActivityAt: hoursAgo(6),
          siteVisitAt: new Date(now.getTime() + 6 * 60 * 60 * 1000),
          customData: JSON.stringify({
            unitType: "4BR dual key",
            buyerType: "Upgrade",
            decisionTimeline: "Immediate"
          }),
          createdAt: daysAgo(1)
        },
        {
          workspaceId: workspace.id,
          ownerId: agents[1].id,
          name: "Siti Hajar",
          phone: "+60190010005",
          source: LeadSource.REFERRAL_QR,
          sourceDetail: "Showroom QR referral",
          project: "Emerald Lake Homes",
          stage: LeadStage.SITE_VISIT_BOOKED,
          pipelineStageKey: "viewing_booked",
          industryType: IndustryType.PROPERTY,
          priority: LeadPriority.MEDIUM,
          budget: 480000,
          preferredArea: "Sungai Buloh",
          financingStatus: "EPF withdrawal inquiry",
          note: "Needs child-friendly layout.",
          lastMessage: "Can I bring my parents along for the viewing?",
          responseMinutes: 5,
          nextActionAt: new Date(now.getTime() + 28 * 60 * 60 * 1000),
          lastActivityAt: hoursAgo(3),
          siteVisitAt: new Date(now.getTime() + 30 * 60 * 60 * 1000),
          customData: JSON.stringify({
            unitType: "Townhouse",
            buyerType: "Family upgrade"
          }),
          createdAt: daysAgo(2)
        },
        {
          workspaceId: workspace.id,
          ownerId: agents[2].id,
          name: "Daniel Ong",
          phone: "+60190010006",
          source: LeadSource.PROPERTY_PORTAL,
          sourceDetail: "iProperty organic listing",
          project: "Skylane @ PJ Sentral",
          stage: LeadStage.NEGOTIATION,
          pipelineStageKey: "negotiation",
          industryType: IndustryType.PROPERTY,
          priority: LeadPriority.HIGH,
          budget: 860000,
          preferredArea: "Petaling Jaya",
          financingStatus: "Awaiting rebate details",
          note: "Comparing two layouts before booking fee.",
          lastMessage: "Can you send me the updated rebate structure?",
          responseMinutes: 6,
          nextActionAt: new Date(now.getTime() + 4 * 60 * 60 * 1000),
          lastActivityAt: hoursAgo(12),
          customData: JSON.stringify({
            unitType: "3BR",
            buyerType: "Investment",
            decisionTimeline: "2 weeks"
          }),
          createdAt: daysAgo(3)
        }
      ]
    });

    const conversations = await prisma.$transaction([
      prisma.conversation.create({
        data: {
          workspaceId: workspace.id,
          contactId: contacts[0].id,
          assigneeId: agents[0].id,
          subject: "The Grove Residences purchase enquiry",
          status: ConversationStatus.OPEN,
          unreadCount: 2,
          isHotLead: true,
          lastMessagePreview: "If I book this week, is there any rebate available?",
          lastMessageAt: hoursAgo(1)
        }
      }),
      prisma.conversation.create({
        data: {
          workspaceId: workspace.id,
          contactId: contacts[1].id,
          assigneeId: agents[1].id,
          subject: "Tenancy renewal and maintenance issue",
          status: ConversationStatus.PENDING,
          unreadCount: 0,
          isHotLead: false,
          lastMessagePreview: "Thank you, I will wait for the technician tomorrow.",
          lastMessageAt: hoursAgo(4)
        }
      }),
      prisma.conversation.create({
        data: {
          workspaceId: workspace.id,
          contactId: contacts[2].id,
          assigneeId: null,
          subject: "Weekend showroom visit request",
          status: ConversationStatus.OPEN,
          unreadCount: 1,
          isHotLead: true,
          lastMessagePreview: "Can someone confirm the slot for Sunday at 2pm?",
          lastMessageAt: hoursAgo(2)
        }
      })
    ]);

    await prisma.quickReply.createMany({
      data: [
        {
          workspaceId: workspace.id,
          title: "Project brochure",
          shortcut: "/brochure",
          body: "Here is the latest project brochure and floor plan. Let me know which unit type you want to shortlist."
        },
        {
          workspaceId: workspace.id,
          title: "Viewing confirmation",
          shortcut: "/viewing",
          body: "Your viewing is confirmed. Please arrive 10 minutes early and bring IC for registration."
        },
        {
          workspaceId: workspace.id,
          title: "Handoff pending",
          shortcut: "/pending",
          body: "Thank you for your message. I have flagged this for the assigned team member and we will update you shortly."
        }
      ]
    });

    await prisma.automationRule.createMany({
      data: [
        {
          workspaceId: workspace.id,
          name: "Welcome message",
          triggerType: "WELCOME_MESSAGE",
          replyBody: "Thanks for messaging us. Our team has received your enquiry and will reply shortly.",
          enabled: true
        },
        {
          workspaceId: workspace.id,
          name: "Keyword: price",
          triggerType: "KEYWORD_MATCH",
          keyword: "price",
          replyBody: "Please share the project name or unit type you are asking about, and we will send the latest pricing sheet.",
          enabled: true
        },
        {
          workspaceId: workspace.id,
          name: "Follow-up reminder",
          triggerType: "FOLLOW_UP",
          replyBody: "Just following up on your earlier enquiry. Let us know if you want to continue the discussion or schedule a viewing.",
          enabled: false
        }
      ]
    });

    await prisma.message.createMany({
      data: [
        {
          conversationId: conversations[0].id,
          direction: MessageDirection.INBOUND,
          body: "Hi, I saw your ad for The Grove Residences. Is the 3-bedroom layout still available?",
          sentAt: hoursAgo(3)
        },
        {
          conversationId: conversations[0].id,
          senderId: agents[0].id,
          direction: MessageDirection.OUTBOUND,
          body: "Yes, a few units are still open. May I know your target budget and preferred floor?",
          sentAt: hoursAgo(2)
        },
        {
          conversationId: conversations[0].id,
          direction: MessageDirection.INBOUND,
          body: "If I book this week, is there any rebate available?",
          sentAt: hoursAgo(1)
        },
        {
          conversationId: conversations[1].id,
          direction: MessageDirection.INBOUND,
          body: "The air-conditioner is leaking again. Can your team arrange a technician?",
          sentAt: hoursAgo(8)
        },
        {
          conversationId: conversations[1].id,
          senderId: agents[1].id,
          direction: MessageDirection.OUTBOUND,
          body: "Scheduled for tomorrow morning. I will update you once the technician confirms the slot.",
          sentAt: hoursAgo(5)
        },
        {
          conversationId: conversations[1].id,
          direction: MessageDirection.INBOUND,
          body: "Thank you, I will wait for the technician tomorrow.",
          sentAt: hoursAgo(4)
        },
        {
          conversationId: conversations[2].id,
          direction: MessageDirection.INBOUND,
          body: "Can someone confirm the slot for Sunday at 2pm?",
          sentAt: hoursAgo(2)
        }
      ]
    });

    await prisma.note.createMany({
      data: [
        {
          workspaceId: workspace.id,
          contactId: contacts[0].id,
          conversationId: conversations[0].id,
          authorId: agents[0].id,
          body: "Hot lead. Asked twice about rebate and legal fee absorption."
        },
        {
          workspaceId: workspace.id,
          contactId: contacts[2].id,
          conversationId: conversations[2].id,
          authorId: agents[1].id,
          body: "Unassigned because she came in through the weekend QR campaign."
        }
      ]
    });

    return {
      target: getDatabaseTarget(),
      counts: await collectResetCounts(prisma)
    };
  } finally {
    await prisma.$disconnect();
  }
}
