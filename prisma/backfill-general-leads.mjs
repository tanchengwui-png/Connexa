import "dotenv/config";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });

const sourceMapping = {
  PROPERTY_PORTAL: "MARKETPLACE",
  WEBSITE_CHAT: "WHATSAPP",
  REFERRAL_QR: "QR_CODE"
};

const stageToPipelineKey = {
  NEW_LEAD: "new_lead",
  CONTACTED: "contacted",
  QUALIFIED: "qualified",
  SITE_VISIT_BOOKED: "site_visit_booked",
  FOLLOW_UP: "follow_up",
  NEGOTIATION: "negotiation",
  CLOSED_WON: "closed_won",
  CLOSED_LOST: "closed_lost"
};

function parseCustomData(value) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return { legacyCustomData: value };
  }
}

function setIfPresent(target, key, value) {
  if (value === null || value === undefined || value === "") {
    return;
  }

  if (target[key] === undefined || target[key] === null || target[key] === "") {
    target[key] = value;
  }
}

try {
  await client.connect();

  for (const value of ["WHATSAPP", "WEBSITE", "QR_CODE", "REFERRAL", "MANUAL", "IMPORT", "MARKETPLACE", "OTHER"]) {
    await client.query(`ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS '${value}'`);
  }

  await client.query(`ALTER TYPE "LeadStage" ADD VALUE IF NOT EXISTS 'CONTACTED'`);

  await client.query("BEGIN");

  await client.query(`
    ALTER TABLE "Lead"
      ADD COLUMN IF NOT EXISTS "pipelineId" TEXT,
      ADD COLUMN IF NOT EXISTS "value" INTEGER,
      ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'MYR'
  `);

  const { rows } = await client.query(`
    SELECT
      id,
      source::text AS source,
      stage::text AS stage,
      project,
      budget,
      "preferredArea",
      "financingStatus",
      "siteVisitAt",
      "industryType"::text AS "industryType",
      "pipelineStageKey",
      value,
      currency,
      "customData"
    FROM "Lead"
  `);

  for (const row of rows) {
    const customData = parseCustomData(row.customData);
    setIfPresent(customData, "project", row.project);
    setIfPresent(customData, "budget", row.budget === null ? null : String(row.budget));
    setIfPresent(customData, "preferredArea", row.preferredArea);
    setIfPresent(customData, "financingStatus", row.financingStatus);
    setIfPresent(customData, "siteVisitAt", row.siteVisitAt ? row.siteVisitAt.toISOString() : null);
    setIfPresent(customData, "industryType", row.industryType);

    const nextSource = sourceMapping[row.source] ?? row.source;
    const nextPipelineStageKey = row.pipelineStageKey || stageToPipelineKey[row.stage] || "new_lead";
    const nextValue = row.value ?? row.budget ?? null;
    const nextCurrency = row.currency || "MYR";

    await client.query(
      `
        UPDATE "Lead"
        SET source = $2::"LeadSource",
            "pipelineStageKey" = $3,
            value = $4,
            currency = $5,
            "customData" = $6,
            "updatedAt" = NOW()
        WHERE id = $1
      `,
      [row.id, nextSource, nextPipelineStageKey, nextValue, nextCurrency, JSON.stringify(customData)]
    );
  }

  await client.query("COMMIT");
  console.log(`Backfilled ${rows.length} lead records.`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
