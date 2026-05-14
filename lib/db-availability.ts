import { execute, queryMany, queryOne, transaction } from "@/lib/db";
import { AvailabilityOverrideType } from "@/lib/db-types";

export type AgentAvailabilityRuleRow = {
  dayOfWeek: number;
  enabled: boolean;
  startTime: string;
  endTime: string;
};

export type AgentAvailabilityOverrideRow = {
  id: string;
  type: AvailabilityOverrideType;
  startAt: Date;
  endAt: Date;
  note: string | null;
};

export type AgentAvailabilityRow = {
  availabilityRules: AgentAvailabilityRuleRow[];
  availabilityOverrides: AgentAvailabilityOverrideRow[];
};

export type WorkspaceAvailabilityAgentRow = {
  agentId: string;
  agentName: string;
  availabilityRules: AgentAvailabilityRuleRow[];
  availabilityOverrides: AgentAvailabilityOverrideRow[];
};

export async function findAgentAvailability(agentId: string) {
  const agent = await queryOne<{ id: string }>(
    `SELECT id
     FROM "Agent"
     WHERE id = $1
     LIMIT 1`,
    [agentId]
  );

  if (!agent) {
    return null;
  }

  const [availabilityRules, availabilityOverrides] = await Promise.all([
    queryMany<AgentAvailabilityRuleRow>(
      `SELECT "dayOfWeek" AS "dayOfWeek", enabled, "startTime" AS "startTime", "endTime" AS "endTime"
       FROM "AgentAvailabilityRule"
       WHERE "agentId" = $1
       ORDER BY "dayOfWeek" ASC`,
      [agentId]
    ),
    queryMany<AgentAvailabilityOverrideRow>(
      `SELECT id, type, "startAt" AS "startAt", "endAt" AS "endAt", note
       FROM "AgentAvailabilityOverride"
       WHERE "agentId" = $1
       ORDER BY "startAt" ASC`,
      [agentId]
    )
  ]);

  return {
    availabilityRules,
    availabilityOverrides
  } satisfies AgentAvailabilityRow;
}

export async function replaceAgentAvailability(
  agentId: string,
  input: {
    weeklyRules: AgentAvailabilityRuleRow[];
    overrides: Array<Omit<AgentAvailabilityOverrideRow, "id">>;
  }
) {
  await transaction(async (client) => {
    await execute(`DELETE FROM "AgentAvailabilityRule" WHERE "agentId" = $1`, [agentId], client);
    await execute(`DELETE FROM "AgentAvailabilityOverride" WHERE "agentId" = $1`, [agentId], client);

    for (const rule of input.weeklyRules) {
      await execute(
        `INSERT INTO "AgentAvailabilityRule" ("agentId", "dayOfWeek", enabled, "startTime", "endTime")
         VALUES ($1, $2, $3, $4, $5)`,
        [agentId, rule.dayOfWeek, rule.enabled, rule.startTime, rule.endTime],
        client
      );
    }

    for (const override of input.overrides) {
      await execute(
        `INSERT INTO "AgentAvailabilityOverride" ("agentId", type, "startAt", "endAt", note)
         VALUES ($1, $2, $3, $4, $5)`,
        [agentId, override.type, override.startAt, override.endAt, override.note],
        client
      );
    }
  });
}

export async function listWorkspaceAvailabilityAgents(workspaceId: string) {
  const agents = await queryMany<{ id: string; name: string }>(
    `SELECT id, name
     FROM "Agent"
     WHERE "workspaceId" = $1
     ORDER BY name ASC`,
    [workspaceId]
  );

  if (agents.length === 0) {
    return [] satisfies WorkspaceAvailabilityAgentRow[];
  }

  const agentIds = agents.map((agent) => agent.id);
  const [rules, overrides] = await Promise.all([
    queryMany<{ agentId: string; dayOfWeek: number; enabled: boolean; startTime: string; endTime: string }>(
      `SELECT "agentId" AS "agentId", "dayOfWeek" AS "dayOfWeek", enabled, "startTime" AS "startTime", "endTime" AS "endTime"
       FROM "AgentAvailabilityRule"
       WHERE "agentId" = ANY($1::text[])`,
      [agentIds]
    ),
    queryMany<{ agentId: string; id: string; type: AvailabilityOverrideType; startAt: Date; endAt: Date; note: string | null }>(
      `SELECT "agentId" AS "agentId", id, type, "startAt" AS "startAt", "endAt" AS "endAt", note
       FROM "AgentAvailabilityOverride"
       WHERE "agentId" = ANY($1::text[]) AND "endAt" >= NOW()
       ORDER BY "startAt" ASC`,
      [agentIds]
    )
  ]);

  const rulesByAgent = new Map<string, AgentAvailabilityRuleRow[]>();
  for (const rule of rules) {
    const existing = rulesByAgent.get(rule.agentId) ?? [];
    existing.push({
      dayOfWeek: rule.dayOfWeek,
      enabled: rule.enabled,
      startTime: rule.startTime,
      endTime: rule.endTime
    });
    rulesByAgent.set(rule.agentId, existing);
  }

  const overridesByAgent = new Map<string, AgentAvailabilityOverrideRow[]>();
  for (const override of overrides) {
    const existing = overridesByAgent.get(override.agentId) ?? [];
    existing.push({
      id: override.id,
      type: override.type,
      startAt: override.startAt,
      endAt: override.endAt,
      note: override.note
    });
    overridesByAgent.set(override.agentId, existing);
  }

  return agents.map((agent) => ({
    agentId: agent.id,
    agentName: agent.name,
    availabilityRules: rulesByAgent.get(agent.id) ?? [],
    availabilityOverrides: overridesByAgent.get(agent.id) ?? []
  }));
}
