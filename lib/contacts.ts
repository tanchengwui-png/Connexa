import { prisma } from "@/lib/prisma";
import { requireCurrentAgent, requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { formatPhoneForDisplay } from "@/lib/phone";

export async function getContactsData(search?: string) {
  const workspaceId = await requireCurrentWorkspaceId();
  const workspace = await prisma.workspace.findUnique({
    where: {
      id: workspaceId
    },
    include: {
      contacts: {
        include: {
          owner: true,
          conversations: {
            orderBy: {
              lastMessageAt: "desc"
            },
            take: 1
          },
          notes: {
            include: {
              author: true
            },
            orderBy: {
              createdAt: "desc"
            },
            take: 2
          }
        },
        orderBy: {
          lastInteractionAt: "desc"
        }
      },
      agents: {
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });

  if (!workspace) {
    throw new Error("No workspace found. Run the database seed first.");
  }

  const query = search?.trim().toLowerCase();
  const filteredContacts = workspace.contacts.filter((contact) => {
    if (!query) {
      return true;
    }

    return (
      contact.displayName.toLowerCase().includes(query) ||
      contact.phone.toLowerCase().includes(query) ||
      formatPhoneForDisplay(contact.phone).toLowerCase().includes(query) ||
      contact.tags.toLowerCase().includes(query)
    );
  });

  const contacts = filteredContacts.map((contact) => ({
    id: contact.id,
    displayName: contact.displayName,
    displayNameManualOverride: contact.displayNameManualOverride,
    phone: formatPhoneForDisplay(contact.phone),
    email: contact.email,
    emailManualOverride: contact.emailManualOverride,
    ownerId: contact.ownerId,
    ownerName: contact.owner?.name ?? null,
    isHotLead: contact.isHotLead,
    tags: splitTags(contact.tags),
    tagsManualOverride: contact.tagsManualOverride,
    lastInteractionAt: formatAbsoluteDateTime(contact.lastInteractionAt),
    lastMessagePreview:
      contact.conversations[0]?.lastMessagePreview ?? "No conversation history yet.",
    conversationStatus: contact.conversations[0]?.status ?? null,
    notes: contact.notes.map((note) => ({
      id: note.id,
      body: note.body,
      author: note.author.name,
      createdAt: formatAbsoluteDateTime(note.createdAt)
    }))
  }));

  return {
    summary: {
      total: workspace.contacts.length,
      active: workspace.contacts.length,
      hotLeads: workspace.contacts.filter((contact) => contact.isHotLead).length,
      recentlyActive: workspace.contacts.filter(
        (contact) => Date.now() - contact.lastInteractionAt.getTime() < 24 * 60 * 60 * 1000
      ).length
    },
    agents: workspace.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role
    })),
    contacts,
    search: search ?? ""
  };
}

export async function createContactNote(input: { contactId: string; body: string }) {
  const agent = await requireCurrentAgent();
  const normalizedBody = input.body.trim();

  if (!normalizedBody) {
    throw new Error("Note body is required.");
  }

  const contact = await prisma.contact.findFirst({
    where: {
      id: input.contactId,
      workspaceId: agent.workspaceId
    },
    select: {
      id: true
    }
  });

  if (!contact) {
    throw new Error("Contact not found.");
  }

  const note = await prisma.note.create({
    data: {
      workspaceId: agent.workspaceId,
      contactId: contact.id,
      authorId: agent.id,
      body: normalizedBody
    },
    include: {
      author: true
    }
  });

  return {
    id: note.id,
    body: note.body,
    author: note.author.name,
    createdAt: formatRelativeAge(note.createdAt)
  };
}

function splitTags(tags: string) {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatRelativeAge(date: Date) {
  return formatAbsoluteDateTime(date);
}

function formatAbsoluteDateTime(date: Date) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}
