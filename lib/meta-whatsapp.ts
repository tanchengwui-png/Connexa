import { randomBytes } from "node:crypto";
import { sanitizeSensitiveText } from "@/lib/crypto";
import { getResolvedPlatformMetaConfig } from "@/lib/platform-config";
import {
  isMetaEmbeddedSignupConfigurationComplete,
  normalizeMetaGraphVersion
} from "@/lib/meta-configuration";
import {
  getWhatsAppCloudFeatureFlags,
  isWhatsAppCloudEnabledForWorkspace
} from "@/lib/whatsapp-cloud/feature-flags";

type MetaGraphEnvelope<T> = {
  data?: T[];
};

type MetaPhoneNumberNode = {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  code_verification_status?: string;
  quality_rating?: string;
  is_on_biz_app?: boolean;
  platform_type?: string;
};

type MetaWabaNode = {
  id?: string;
  name?: string;
  phone_numbers?: MetaGraphEnvelope<MetaPhoneNumberNode>;
};

type MetaBusinessNode = {
  id?: string;
  name?: string;
  owned_whatsapp_business_accounts?: MetaGraphEnvelope<MetaWabaNode>;
  client_whatsapp_business_accounts?: MetaGraphEnvelope<MetaWabaNode>;
};

export type MetaEmbeddedSignupPhoneNumber = {
  businessAccountId: string | null;
  businessName: string | null;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  codeVerificationStatus: string | null;
  qualityRating: string | null;
  isOnBizApp: boolean | null;
  platformType: string | null;
};

export function getMetaGraphVersion() {
  return normalizeMetaGraphVersion(
    process.env.META_GRAPH_API_VERSION?.trim() ||
      process.env.META_GRAPH_VERSION?.trim()
  );
}

export async function getMetaEmbeddedSignupConfig(workspaceId?: string) {
  const resolvedConfig = await getResolvedPlatformMetaConfig();
  const appId = resolvedConfig.appId.trim();
  const configId = resolvedConfig.configId.trim();
  const flags = getWhatsAppCloudFeatureFlags();
  const cloudEnabled = workspaceId
    ? isWhatsAppCloudEnabledForWorkspace(workspaceId, flags)
    : flags.cloudEnabled;
  const fullyConfigured = isMetaEmbeddedSignupConfigurationComplete({
    appId,
    appSecret: resolvedConfig.appSecret,
    configId,
    redirectUri: resolvedConfig.redirectUri,
    webhookVerifyToken: resolvedConfig.webhookVerifyToken
  });

  return {
    enabled: cloudEnabled && fullyConfigured,
    coexistenceEnabled: cloudEnabled && fullyConfigured && flags.coexistenceEnabled,
    appId,
    configId,
    graphVersion: resolvedConfig.graphVersion.trim() || getMetaGraphVersion()
  };
}

function buildMetaGraphUrl(path: string, graphVersion: string, params: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/${graphVersion}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function parseMetaGraphResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string; type?: string } }
    | T
    | null;

  if (!response.ok) {
    const graphError =
      payload && typeof payload === "object" && "error" in payload && payload.error
        ? `${payload.error.type ?? "MetaGraphError"}: ${payload.error.message ?? "Unknown Meta Graph error."}`
        : `Meta Graph request failed with status ${response.status}.`;
    throw new Error(sanitizeSensitiveText(graphError));
  }

  return payload as T;
}

async function metaGraphGet<T>(path: string, graphVersion: string, params: Record<string, string>) {
  const response = await fetch(buildMetaGraphUrl(path, graphVersion, params), {
    method: "GET",
    cache: "no-store"
  });

  return parseMetaGraphResponse<T>(response);
}

async function metaGraphPost<T>(
  path: string,
  graphVersion: string,
  accessToken: string,
  body: Record<string, unknown>
) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  return parseMetaGraphResponse<T>(response);
}

function pickFirstPhoneNumber(wabas: MetaWabaNode[]) {
  for (const waba of wabas) {
    const phoneNumbers = Array.isArray(waba.phone_numbers?.data) ? waba.phone_numbers.data : [];
    for (const phone of phoneNumbers) {
      const phoneNumberId = `${phone.id ?? ""}`.trim();
      if (!phoneNumberId) {
        continue;
      }

      return {
        businessAccountId: `${waba.id ?? ""}`.trim() || null,
        phoneNumberId,
        displayPhoneNumber:
          `${phone.display_phone_number ?? ""}`.trim() || `${phone.verified_name ?? ""}`.trim() || null
      };
    }
  }

  return null;
}

function listPhoneNumbersFromBusinesses(businesses: MetaBusinessNode[]) {
  const phoneNumbers: MetaEmbeddedSignupPhoneNumber[] = [];

  for (const business of businesses) {
    const owned = Array.isArray(business.owned_whatsapp_business_accounts?.data)
      ? business.owned_whatsapp_business_accounts.data
      : [];
    const client = Array.isArray(business.client_whatsapp_business_accounts?.data)
      ? business.client_whatsapp_business_accounts.data
      : [];

    for (const waba of [...owned, ...client]) {
      const wabaPhoneNumbers = Array.isArray(waba.phone_numbers?.data) ? waba.phone_numbers.data : [];
      for (const phone of wabaPhoneNumbers) {
        const phoneNumberId = `${phone.id ?? ""}`.trim();
        if (!phoneNumberId) {
          continue;
        }

        phoneNumbers.push({
          businessAccountId: `${waba.id ?? ""}`.trim() || null,
          businessName: `${waba.name ?? business.name ?? ""}`.trim() || null,
          phoneNumberId,
          displayPhoneNumber: `${phone.display_phone_number ?? ""}`.trim() || null,
          verifiedName: `${phone.verified_name ?? ""}`.trim() || null,
          codeVerificationStatus: `${phone.code_verification_status ?? ""}`.trim() || null,
          qualityRating: `${phone.quality_rating ?? ""}`.trim() || null,
          isOnBizApp: typeof phone.is_on_biz_app === "boolean" ? phone.is_on_biz_app : null,
          platformType: `${phone.platform_type ?? ""}`.trim() || null
        });
      }
    }
  }

  return phoneNumbers;
}

function extractEmbeddedSignupTarget(payload: {
  businesses?: MetaGraphEnvelope<MetaBusinessNode>;
  data?: MetaBusinessNode[];
}) {
  const businesses = Array.isArray(payload.businesses?.data)
    ? payload.businesses?.data ?? []
    : Array.isArray(payload.data)
      ? payload.data
      : [];

  for (const business of businesses) {
    const owned = Array.isArray(business.owned_whatsapp_business_accounts?.data)
      ? business.owned_whatsapp_business_accounts.data
      : [];
    const client = Array.isArray(business.client_whatsapp_business_accounts?.data)
      ? business.client_whatsapp_business_accounts.data
      : [];
    const match = pickFirstPhoneNumber([...owned, ...client]);
    if (match) {
      return match;
    }
  }

  return null;
}

export async function exchangeMetaEmbeddedSignupCode(code: string) {
  const normalizedCode = code.trim();
  if (!normalizedCode) {
    throw new Error("Meta authorization code is required.");
  }
  const resolvedConfig = await getResolvedPlatformMetaConfig();
  const appId = resolvedConfig.appId.trim();
  const appSecret = resolvedConfig.appSecret.trim();
  const redirectUri = resolvedConfig.redirectUri.trim();
  const graphVersion = resolvedConfig.graphVersion.trim() || getMetaGraphVersion();

  if (!appId || !appSecret) {
    throw new Error("Meta Embedded Signup is not fully configured on the platform settings screen.");
  }

  const exchangeParameters: Record<string, string> = {
    client_id: appId,
    client_secret: appSecret,
    code: normalizedCode
  };
  if (redirectUri) {
    exchangeParameters.redirect_uri = redirectUri;
  }

  const payload = await metaGraphGet<{
    access_token: string;
    token_type?: string;
    expires_in?: number;
  }>("/oauth/access_token", graphVersion, exchangeParameters);

  const accessToken = `${payload.access_token ?? ""}`.trim();
  if (!accessToken) {
    throw new Error("Meta OAuth exchange did not return an access token.");
  }

  const tokenExpiresAt =
    typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) && payload.expires_in > 0
      ? new Date(Date.now() + payload.expires_in * 1000)
      : null;

  return {
    accessToken,
    tokenExpiresAt
  };
}

export async function fetchMetaEmbeddedSignupBusinessProfile(accessToken: string) {
  const normalizedAccessToken = accessToken.trim();
  if (!normalizedAccessToken) {
    throw new Error("Meta access token is required.");
  }
  const resolvedConfig = await getResolvedPlatformMetaConfig();
  const graphVersion = resolvedConfig.graphVersion.trim() || getMetaGraphVersion();

  const mePayload = await metaGraphGet<{
    businesses?: MetaGraphEnvelope<MetaBusinessNode>;
  }>("/me", graphVersion, {
    access_token: normalizedAccessToken,
    fields:
      "businesses{id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}},client_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}}"
  }).catch(() => null);

  const meMatch = mePayload ? extractEmbeddedSignupTarget(mePayload) : null;
  if (meMatch) {
    return meMatch;
  }

  const businessesPayload = await metaGraphGet<{
    data?: MetaBusinessNode[];
  }>("/me/businesses", graphVersion, {
    access_token: normalizedAccessToken,
    fields:
      "id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}},client_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}"
  });
  const businessMatch = extractEmbeddedSignupTarget(businessesPayload);

  if (!businessMatch) {
    throw new Error("Meta Embedded Signup did not return a WhatsApp Business Account with a phone number.");
  }

  return businessMatch;
}

export async function fetchMetaEmbeddedSignupPhoneNumbers(accessToken: string) {
  const normalizedAccessToken = accessToken.trim();
  if (!normalizedAccessToken) {
    throw new Error("Meta access token is required.");
  }
  const resolvedConfig = await getResolvedPlatformMetaConfig();
  const graphVersion = resolvedConfig.graphVersion.trim() || getMetaGraphVersion();
  const fields =
    "id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name,code_verification_status,quality_rating,is_on_biz_app,platform_type}},client_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name,code_verification_status,quality_rating,is_on_biz_app,platform_type}}";

  const mePayload = await metaGraphGet<{
    businesses?: MetaGraphEnvelope<MetaBusinessNode>;
  }>("/me", graphVersion, {
    access_token: normalizedAccessToken,
    fields: `businesses{${fields}}`
  }).catch(() => null);
  const meBusinesses = Array.isArray(mePayload?.businesses?.data) ? mePayload.businesses.data : [];
  const mePhoneNumbers = listPhoneNumbersFromBusinesses(meBusinesses);
  if (mePhoneNumbers.length) {
    return mePhoneNumbers;
  }

  const businessesPayload = await metaGraphGet<{
    data?: MetaBusinessNode[];
  }>("/me/businesses", graphVersion, {
    access_token: normalizedAccessToken,
    fields
  });
  const businessPhoneNumbers = listPhoneNumbersFromBusinesses(
    Array.isArray(businessesPayload.data) ? businessesPayload.data : []
  );

  if (!businessPhoneNumbers.length) {
    throw new Error("Meta Embedded Signup did not return any WhatsApp Business phone numbers.");
  }

  return businessPhoneNumbers;
}

export async function getMetaWebhookVerifyToken() {
  const resolvedConfig = await getResolvedPlatformMetaConfig();
  return resolvedConfig.webhookVerifyToken.trim() || null;
}

export async function buildManagedWebhookVerifyToken() {
  return (await getMetaWebhookVerifyToken()) || `connexa-meta-${randomBytes(12).toString("hex")}`;
}

export async function registerMetaCloudPhoneNumber(input: {
  accessToken: string;
  phoneNumberId: string;
  pin: string;
}) {
  const accessToken = input.accessToken.trim();
  const phoneNumberId = input.phoneNumberId.trim();
  const pin = input.pin.trim();

  if (!accessToken || !phoneNumberId) {
    throw new Error("Meta phone number registration requires a token and phone number id.");
  }

  if (!/^\d{6}$/.test(pin)) {
    throw new Error("Meta phone number registration requires a 6-digit PIN.");
  }

  const resolvedConfig = await getResolvedPlatformMetaConfig();
  const graphVersion = resolvedConfig.graphVersion.trim() || getMetaGraphVersion();
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/register`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        pin
      }),
      cache: "no-store"
    }
  );

  return parseMetaGraphResponse<{ success?: boolean }>(response);
}

export async function testMetaPhoneNumberConnection(input: {
  accessToken: string;
  phoneNumberId: string;
}) {
  const accessToken = input.accessToken.trim();
  const phoneNumberId = input.phoneNumberId.trim();

  if (!accessToken || !phoneNumberId) {
    throw new Error("Meta phone number connection test requires both token and phone number id.");
  }
  const resolvedConfig = await getResolvedPlatformMetaConfig();
  const graphVersion = resolvedConfig.graphVersion.trim() || getMetaGraphVersion();

  return metaGraphGet<{
    id?: string;
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    code_verification_status?: string;
  }>(`/${encodeURIComponent(phoneNumberId)}`, graphVersion, {
    access_token: accessToken,
    fields: "id,display_phone_number,verified_name,quality_rating,code_verification_status"
  });
}

export async function subscribeMetaWabaApp(input: {
  accessToken: string;
  businessAccountId: string;
}) {
  const accessToken = input.accessToken.trim();
  const businessAccountId = input.businessAccountId.trim();
  const resolvedConfig = await getResolvedPlatformMetaConfig();
  const graphVersion = resolvedConfig.graphVersion.trim() || getMetaGraphVersion();
  if (!accessToken || !businessAccountId) {
    throw new Error("META_WEBHOOK_SUBSCRIPTION_CONFIGURATION_REQUIRED");
  }

  return metaGraphPost<{ success?: boolean }>(
    `/${encodeURIComponent(businessAccountId)}/subscribed_apps`,
    graphVersion,
    accessToken,
    {}
  );
}
