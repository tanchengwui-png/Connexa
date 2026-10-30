export function isCurrentInboxConversationResponse(input: {
  requestedConversationId: string | null;
  routeConversationId: string | null;
  responseConversationId: string | null;
}) {
  return Boolean(
    input.requestedConversationId &&
      input.routeConversationId === input.requestedConversationId &&
      input.responseConversationId === input.requestedConversationId
  );
}

export function buildInboxHrefWithoutConversation(searchParams: string) {
  const params = new URLSearchParams(searchParams);
  params.delete("conversationId");

  const query = params.toString();
  return query ? `/inbox?${query}` : "/inbox";
}

export function buildInboxHrefWithConversation(searchParams: string, conversationId: string) {
  const params = new URLSearchParams(searchParams);
  params.set("conversationId", conversationId);

  return `/inbox?${params.toString()}`;
}
