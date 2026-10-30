// Runtime configuration remains explicit and independently reviewable. This
// is the safe baseline requested for the staged Embedded Signup v4 rollout.
export const DEFAULT_META_GRAPH_VERSION = "v26.0";

export function normalizeMetaGraphVersion(value?: string | null) {
  const normalized = value?.trim() || DEFAULT_META_GRAPH_VERSION;
  if (!/^v[1-9]\d{0,2}\.0$/.test(normalized)) {
    throw new Error("META_GRAPH_VERSION_INVALID");
  }
  return normalized;
}

export function normalizeMetaRedirectUri(value?: string | null) {
  const normalized = value?.trim() || "";
  if (!normalized) return "";

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("META_REDIRECT_URI_INVALID");
  }

  const localDevelopmentHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const secure = url.protocol === "https:" || (url.protocol === "http:" && localDevelopmentHost);
  if (!secure || url.username || url.password || url.hash) {
    throw new Error("META_REDIRECT_URI_INVALID");
  }

  return normalized;
}

export function isMetaEmbeddedSignupConfigurationComplete(input: {
  appId?: string | null;
  appSecret?: string | null;
  configId?: string | null;
  redirectUri?: string | null;
  webhookVerifyToken?: string | null;
}) {
  return [input.appId, input.appSecret, input.configId, input.webhookVerifyToken].every((value) =>
    Boolean(value?.trim())
  );
}
