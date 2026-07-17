export const activeWhatsAppStatuses = ["AUTHENTICATED", "CONNECTED", "SYNCING_HISTORY", "READY"];
export const runnableOutboundStatuses = ["PENDING", "RUNNING"];

export const targetWorkspaceIdsQuery = `
  with workspace_candidates as (
    select "workspaceId"
    from "WhatsAppChannel"
    where "connectionStatus" = any($1::text[])
       or ("phoneNumberId" is not null and "accessTokenCiphertext" is not null)

    union

    select "workspaceId"
    from "OutboundMessageJob"
    where status::text = any($2::text[])
  )
  select distinct "workspaceId"
  from workspace_candidates
  where coalesce("workspaceId", '') <> ''
  order by "workspaceId" asc
`;
