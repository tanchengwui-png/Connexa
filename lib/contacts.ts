import { requireCurrentAgent, requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import {
  countVisibleContacts,
  createContactNoteRecord,
  getContactDirectorySummary,
  findAllVisibleContactsWithOwner,
  findContactsWithOwner,
  findContactInWorkspace,
  findLatestConversationPreviewByWorkspace,
  findLatestNotesByWorkspace,
  listContactTeammatesByWorkspace,
  findWorkspaceAgents
} from "@/lib/db-contacts";
import { formatPhoneForDisplay } from "@/lib/phone";

const DEFAULT_CONTACTS_PAGE_SIZE = 25;
const MAX_CONTACTS_PAGE_SIZE = 100;

export async function getContactsData(input?: {
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const workspaceId = await requireCurrentWorkspaceId();
  const search = input?.search?.trim() ?? "";
  const pageSize = normalizePositiveInteger(input?.pageSize, DEFAULT_CONTACTS_PAGE_SIZE, MAX_CONTACTS_PAGE_SIZE);
  const total = await countVisibleContacts({ workspaceId, search });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(normalizePositiveInteger(input?.page, 1), totalPages);
  const offset = (page - 1) * pageSize;

  const [contactsRows, agents, summary] = await Promise.all([
    findContactsWithOwner({ workspaceId, search, limit: pageSize, offset }),
    findWorkspaceAgents(workspaceId),
    getContactDirectorySummary(workspaceId)
  ]);
  const contactIds = contactsRows.map((contact) => contact.id);
  const [previews, notes, teammateRows] = await Promise.all([
    findLatestConversationPreviewByWorkspace(workspaceId, contactIds),
    findLatestNotesByWorkspace(workspaceId, contactIds),
    listContactTeammatesByWorkspace(workspaceId, contactIds)
  ]);

  const previewByContactId = new Map(previews.map((preview) => [preview.contactId, preview]));
  const notesByContactId = new Map<string, typeof notes>();

  for (const note of notes) {
    const existing = notesByContactId.get(note.contactId) ?? [];
    existing.push(note);
    notesByContactId.set(note.contactId, existing);
  }

  const teammatesByContactId = new Map<string, Array<{ id: string; name: string }>>();
  for (const teammate of teammateRows) {
    const existing = teammatesByContactId.get(teammate.contactId) ?? [];
    existing.push({
      id: teammate.agentId,
      name: teammate.agentName
    });
    teammatesByContactId.set(teammate.contactId, existing);
  }

  const contacts = contactsRows.map((contact) => ({
    id: contact.id,
    displayName: contact.displayName,
    displayNameManualOverride: contact.displayNameManualOverride,
    phone: formatPhoneForDisplay(contact.phone),
    photoUrl: contact.photoUrl,
    email: contact.email,
    emailManualOverride: contact.emailManualOverride,
    addressLine1: contact.addressLine1,
    addressLine2: contact.addressLine2,
    city: contact.city,
    state: contact.state,
    postalCode: contact.postalCode,
    country: contact.country,
    ownerId: contact.ownerId,
    ownerName: contact.ownerName,
    teammateIds: (teammatesByContactId.get(contact.id) ?? []).map((teammate) => teammate.id),
    teammates: teammatesByContactId.get(contact.id) ?? [],
    isHotLead: contact.isHotLead,
    tags: splitTags(contact.tags),
    tagsManualOverride: contact.tagsManualOverride,
    lastInteractionAt: formatAbsoluteDateTime(contact.lastInteractionAt),
    lastMessagePreview: previewByContactId.get(contact.id)?.lastMessagePreview ?? "No conversation history yet.",
    conversationStatus: previewByContactId.get(contact.id)?.status ?? null,
    notes: (notesByContactId.get(contact.id) ?? []).map((note) => ({
      id: note.id,
      body: note.body,
      author: note.authorName,
      createdAt: formatAbsoluteDateTime(note.createdAt)
    }))
  }));

  return {
    summary,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role
    })),
    contacts,
    search,
    pagination: {
      total,
      page,
      pageSize,
      totalPages,
      pageCount: contacts.length
    }
  };
}

export async function getAllVisibleContactsData(input?: {
  search?: string;
}) {
  const workspaceId = await requireCurrentWorkspaceId();
  const search = input?.search?.trim() ?? "";

  const [contactsRows, agents, summary] = await Promise.all([
    findAllVisibleContactsWithOwner({ workspaceId, search }),
    findWorkspaceAgents(workspaceId),
    getContactDirectorySummary(workspaceId)
  ]);
  const contactIds = contactsRows.map((contact) => contact.id);
  const [previews, notes, teammateRows] = await Promise.all([
    findLatestConversationPreviewByWorkspace(workspaceId, contactIds),
    findLatestNotesByWorkspace(workspaceId, contactIds),
    listContactTeammatesByWorkspace(workspaceId, contactIds)
  ]);

  const previewByContactId = new Map(previews.map((preview) => [preview.contactId, preview]));
  const notesByContactId = new Map<string, typeof notes>();

  for (const note of notes) {
    const existing = notesByContactId.get(note.contactId) ?? [];
    existing.push(note);
    notesByContactId.set(note.contactId, existing);
  }

  const teammatesByContactId = new Map<string, Array<{ id: string; name: string }>>();
  for (const teammate of teammateRows) {
    const existing = teammatesByContactId.get(teammate.contactId) ?? [];
    existing.push({
      id: teammate.agentId,
      name: teammate.agentName
    });
    teammatesByContactId.set(teammate.contactId, existing);
  }

  const contacts = contactsRows.map((contact) => ({
    id: contact.id,
    displayName: contact.displayName,
    displayNameManualOverride: contact.displayNameManualOverride,
    phone: formatPhoneForDisplay(contact.phone),
    photoUrl: contact.photoUrl,
    email: contact.email,
    emailManualOverride: contact.emailManualOverride,
    addressLine1: contact.addressLine1,
    addressLine2: contact.addressLine2,
    city: contact.city,
    state: contact.state,
    postalCode: contact.postalCode,
    country: contact.country,
    ownerId: contact.ownerId,
    ownerName: contact.ownerName,
    teammateIds: (teammatesByContactId.get(contact.id) ?? []).map((teammate) => teammate.id),
    teammates: teammatesByContactId.get(contact.id) ?? [],
    isHotLead: contact.isHotLead,
    tags: splitTags(contact.tags),
    tagsManualOverride: contact.tagsManualOverride,
    lastInteractionAt: formatAbsoluteDateTime(contact.lastInteractionAt),
    lastMessagePreview: previewByContactId.get(contact.id)?.lastMessagePreview ?? "No conversation history yet.",
    conversationStatus: previewByContactId.get(contact.id)?.status ?? null,
    notes: (notesByContactId.get(contact.id) ?? []).map((note) => ({
      id: note.id,
      body: note.body,
      author: note.authorName,
      createdAt: formatAbsoluteDateTime(note.createdAt)
    }))
  }));

  return {
    summary,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role
    })),
    contacts,
    search
  };
}

export async function createContactNote(input: { contactId: string; body: string }) {
  const agent = await requireCurrentAgent();
  const normalizedBody = input.body.trim();

  if (!normalizedBody) {
    throw new Error("Note body is required.");
  }

  const contact = await findContactInWorkspace(input.contactId, agent.workspaceId);

  if (!contact) {
    throw new Error("Contact not found.");
  }

  const note = await createContactNoteRecord({
    workspaceId: agent.workspaceId,
    contactId: contact.id,
    authorId: agent.id,
    body: normalizedBody
  });

  return {
    id: note.id,
    body: note.body,
    author: note.authorName,
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
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: MALAYSIA_TIME_ZONE
  }).format(date);
}
import { MALAYSIA_TIME_ZONE } from "@/lib/malaysia-time";

function normalizePositiveInteger(value: number | undefined, fallback: number, max?: number) {
  const normalized = Number.isFinite(value) ? Math.trunc(value as number) : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(normalized) || normalized < 1) {
    return fallback;
  }

  if (max && normalized > max) {
    return max;
  }

  return normalized;
}
