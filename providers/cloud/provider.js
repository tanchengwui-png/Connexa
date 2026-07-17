import axios from "axios";
import { maskSecret, sanitizeSensitiveText } from "@/lib/crypto";

const GRAPH_API_URL = `https://graph.facebook.com/${
  process.env.META_GRAPH_API_VERSION?.trim() || process.env.META_GRAPH_VERSION?.trim() || "v23.0"
}`;

function buildMessagesUrl(phoneNumberId) {
  return `${GRAPH_API_URL}/${encodeURIComponent(phoneNumberId)}/messages`;
}

function assertCloudAccount(account) {
  if (!account) {
    throw new Error("WhatsApp Cloud account is required.");
  }

  if (!account.phoneNumberId) {
    throw new Error("WhatsApp Cloud phoneNumberId is required.");
  }

  if (!account.accessToken) {
    throw new Error("WhatsApp Cloud access token is required.");
  }

  if (!account.workspaceId) {
    throw new Error("WhatsApp Cloud workspace isolation context is required.");
  }
}

function createCloudClient(account) {
  assertCloudAccount(account);

  return axios.create({
    baseURL: buildMessagesUrl(account.phoneNumberId),
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      "Content-Type": "application/json"
    },
    timeout: 30000
  });
}

function normalizeChoices(values, limit) {
  return Array.isArray(values)
    ? values.map((entry) => `${entry ?? ""}`.trim()).filter(Boolean).slice(0, limit)
    : [];
}

function buildButtonsFallback(body, buttons) {
  const lines = buttons.map((button, index) => `${index + 1}. ${button}`);
  return [body.trim(), ...lines].filter(Boolean).join("\n");
}

function buildListFallback(body, buttonText, options) {
  const lines = options.map((option, index) => `${index + 1}. ${option}`);
  const header = buttonText?.trim() ? `${body.trim()}\n${buttonText.trim()}:` : body.trim();
  return [header, ...lines].filter(Boolean).join("\n");
}

function normalizeTemplateParameter(parameter) {
  if (parameter == null) {
    return null;
  }

  if (typeof parameter === "string" || typeof parameter === "number" || typeof parameter === "boolean") {
    return {
      type: "text",
      text: `${parameter}`
    };
  }

  if (typeof parameter !== "object") {
    return null;
  }

  const normalizedType = `${parameter.type ?? ""}`.trim().toLowerCase();
  if (normalizedType === "text") {
    const text = `${parameter.text ?? ""}`.trim();
    return text
      ? {
          type: "text",
          text
        }
      : null;
  }

  if (normalizedType === "currency" && parameter.currency && typeof parameter.currency === "object") {
    const code = `${parameter.currency.code ?? ""}`.trim();
    const amount1000 = Number(parameter.currency.amount_1000);

    if (!code || !Number.isFinite(amount1000)) {
      return null;
    }

    return {
      type: "currency",
      currency: {
        fallback_value: `${parameter.currency.fallback_value ?? ""}`.trim() || `${amount1000 / 1000} ${code}`,
        code,
        amount_1000: amount1000
      }
    };
  }

  if (normalizedType === "date_time" && parameter.date_time && typeof parameter.date_time === "object") {
    const fallbackValue = `${parameter.date_time.fallback_value ?? ""}`.trim();
    return fallbackValue
      ? {
          type: "date_time",
          date_time: {
            fallback_value: fallbackValue
          }
        }
      : null;
  }

  if (normalizedType === "image" || normalizedType === "video" || normalizedType === "document") {
    const media = parameter[normalizedType];
    const link = `${media?.link ?? parameter.link ?? ""}`.trim();

    if (!link) {
      return null;
    }

    const normalizedMedia = {
      link
    };

    if (normalizedType === "document") {
      const filename = `${media?.filename ?? parameter.filename ?? ""}`.trim();
      if (filename) {
        normalizedMedia.filename = filename;
      }
    }

    return {
      type: normalizedType,
      [normalizedType]: normalizedMedia
    };
  }

  if (normalizedType === "payload") {
    const payload = `${parameter.payload ?? ""}`.trim();
    return payload
      ? {
          type: "payload",
          payload
        }
      : null;
  }

  return null;
}

function normalizeTemplateParameters(parameters) {
  return Array.isArray(parameters)
    ? parameters.map((parameter) => normalizeTemplateParameter(parameter)).filter(Boolean)
    : [];
}

function buildBodyComponentFromVariables(input) {
  const directVariables = Array.isArray(input.variables)
    ? input.variables
    : Array.isArray(input.bodyVariables)
      ? input.bodyVariables
      : [];
  const parameters = normalizeTemplateParameters(directVariables);

  if (!parameters.length) {
    return null;
  }

  return {
    type: "body",
    parameters
  };
}

function buildHeaderComponentFromVariables(input) {
  const directVariables = Array.isArray(input.headerVariables) ? input.headerVariables : [];
  const parameters = normalizeTemplateParameters(directVariables);

  if (!parameters.length) {
    return null;
  }

  return {
    type: "header",
    parameters
  };
}

function normalizeTemplateComponent(component) {
  if (!component || typeof component !== "object") {
    return null;
  }

  const type = `${component.type ?? ""}`.trim().toLowerCase();
  if (!type) {
    return null;
  }

  const normalized = {
    type
  };

  if (component.sub_type != null) {
    normalized.sub_type = `${component.sub_type}`;
  }

  if (component.index != null && `${component.index}`.trim()) {
    normalized.index = `${component.index}`.trim();
  }

  const parameters = normalizeTemplateParameters(component.parameters);
  if (parameters.length) {
    normalized.parameters = parameters;
  }

  return normalized;
}

function buildTemplateComponents(input) {
  const normalizedComponents = Array.isArray(input.components)
    ? input.components.map((component) => normalizeTemplateComponent(component)).filter(Boolean)
    : [];

  const hasBodyComponent = normalizedComponents.some((component) => component.type === "body");
  const hasHeaderComponent = normalizedComponents.some((component) => component.type === "header");
  const headerComponent = hasHeaderComponent ? null : buildHeaderComponentFromVariables(input);
  const bodyComponent = hasBodyComponent ? null : buildBodyComponentFromVariables(input);

  return [...normalizedComponents, ...(headerComponent ? [headerComponent] : []), ...(bodyComponent ? [bodyComponent] : [])];
}

function inferMediaType(mimeType, attachmentUrl) {
  const normalizedMime = `${mimeType ?? ""}`.trim().toLowerCase();
  const normalizedUrl = `${attachmentUrl ?? ""}`.trim().toLowerCase();

  if (normalizedMime.startsWith("image/")) {
    return "image";
  }

  if (normalizedMime.startsWith("video/")) {
    return "video";
  }

  if (normalizedMime.startsWith("audio/")) {
    return "audio";
  }

  if (
    normalizedMime.startsWith("application/") ||
    normalizedUrl.endsWith(".pdf") ||
    normalizedUrl.endsWith(".doc") ||
    normalizedUrl.endsWith(".docx")
  ) {
    return "document";
  }

  return "document";
}

function extractProviderMessageId(data) {
  const providerMessageId = data?.messages?.[0]?.id;
  if (!providerMessageId) {
    throw new Error("WhatsApp Cloud API did not return a provider message id.");
  }

  return {
    providerMessageId,
    status: "accepted"
  };
}

function formatCloudError(error) {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.error?.message;
    if (typeof message === "string" && message.trim()) {
      return sanitizeSensitiveText(message.trim());
    }

    if (error.message) {
      return sanitizeSensitiveText(error.message);
    }
  }

  return sanitizeSensitiveText(
    error instanceof Error ? error.message : "WhatsApp Cloud API request failed."
  );
}

async function postCloudMessage(account, payload) {
  try {
    const client = createCloudClient(account);
    const response = await client.post("", {
      messaging_product: "whatsapp",
      ...payload
    });

    return extractProviderMessageId(response.data);
  } catch (error) {
    throw new Error(
      `${formatCloudError(error)} [channel=${account.id ?? "unknown"} token=${maskSecret(
        account.accessTokenLastFour ?? account.accessToken ?? null,
        4
      )}]`
    );
  }
}

export async function sendMedia(input, account) {
  if (!input.attachmentUrl) {
    throw new Error("Media attachmentUrl is required.");
  }

  const mediaType = inferMediaType(input.attachmentMimeType, input.attachmentUrl);
  const payload = {
    to: input.to,
    type: mediaType,
    [mediaType]: {
      link: input.attachmentUrl
    }
  };

  if (input.quotedProviderMessageId) {
    payload.context = {
      message_id: input.quotedProviderMessageId
    };
  }

  const body = `${input.body ?? ""}`.trim();
  if (mediaType !== "audio" && body) {
    payload[mediaType].caption = body;
  }

  if (mediaType === "document" && input.attachmentName?.trim()) {
    payload.document.filename = input.attachmentName.trim();
  }

  return postCloudMessage(account, payload);
}

export async function sendMessage(input, account) {
  const normalizedButtons = normalizeChoices(input.interactiveButtons, 3);
  const normalizedListOptions = normalizeChoices(input.interactiveListOptions, 10);
  const normalizedListButtonText = `${input.interactiveListButtonText ?? ""}`.trim() || "Choose option";

  let body = `${input.body ?? ""}`;
  if (normalizedButtons.length) {
    body = buildButtonsFallback(body, normalizedButtons);
  } else if (normalizedListOptions.length) {
    body = buildListFallback(body, normalizedListButtonText, normalizedListOptions);
  }

  if (input.attachmentUrl) {
    return sendMedia(
      {
        ...input,
        body
      },
      account
    );
  }

  if (!body.trim()) {
    throw new Error("Message body is required.");
  }

  const payload = {
    to: input.to,
    type: "text",
    text: {
      body: body.trim(),
      preview_url: false
    }
  };

  if (input.quotedProviderMessageId) {
    payload.context = {
      message_id: input.quotedProviderMessageId
    };
  }

  return postCloudMessage(account, payload);
}

export async function sendTemplate(input, account) {
  const name = `${input.name ?? ""}`.trim();
  if (!name) {
    throw new Error("Template name is required.");
  }

  const languageCode = `${input.languageCode ?? ""}`.trim() || "en_US";
  const components = buildTemplateComponents(input);
  const payload = {
    to: input.to,
    type: "template",
    template: {
      name,
      language: {
        code: languageCode
      }
    }
  };

  if (components.length) {
    payload.template.components = components;
  }

  return postCloudMessage(account, payload);
}

export async function broadcast(input, account) {
  const results = [];

  for (const recipient of input.recipients ?? []) {
    if (input.template) {
      results.push(await sendTemplate({ ...input.template, ...recipient }, account));
      continue;
    }

    if (recipient.attachmentUrl) {
      results.push(await sendMedia(recipient, account));
      continue;
    }

    results.push(await sendMessage(recipient, account));
  }

  return {
    provider: "cloud",
    sent: results.length,
    results
  };
}
