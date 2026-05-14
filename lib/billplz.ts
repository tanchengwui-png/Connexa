import { createHmac } from "node:crypto";

const BILLPLZ_PRODUCTION_URL = "https://www.billplz.com/api/v3";
const BILLPLZ_SANDBOX_URL = "https://www.billplz-sandbox.com/api/v3";

export type BillplzConfig = {
  apiKey: string;
  collectionId: string;
  xSignatureKey?: string;
  sandbox: boolean;
};

export type BillplzBill = {
  id: string;
  url: string;
};

export type BillplzCollection = {
  id: string;
  title: string;
  status: string;
};

function getBillplzBaseUrl(sandbox: boolean) {
  return sandbox ? BILLPLZ_SANDBOX_URL : BILLPLZ_PRODUCTION_URL;
}

function getBillplzAuthHeader(apiKey: string) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

export async function createBillplzBill(
  config: BillplzConfig,
  input: {
    name: string;
    email: string;
    amount: number;
    description: string;
    callbackUrl: string;
    redirectUrl: string;
  }
) {
  const endpoint = `${getBillplzBaseUrl(config.sandbox)}/bills`;
  const form = new URLSearchParams();
  form.set("collection_id", config.collectionId);
  form.set("description", input.description);
  form.set("email", input.email);
  form.set("name", input.name);
  form.set("amount", String(Math.round(input.amount * 100)));
  form.set("callback_url", input.callbackUrl);
  form.set("redirect_url", input.redirectUrl);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: getBillplzAuthHeader(config.apiKey),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString(),
    cache: "no-store"
  });

  const data = (await response.json()) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };

  if (!response.ok || !data.id || !data.url) {
    throw new Error(data.error?.message ?? "Unable to create Billplz bill.");
  }

  return {
    id: data.id,
    url: data.url
  } satisfies BillplzBill;
}

export async function getBillplzCollection(config: BillplzConfig) {
  const endpoint = `${getBillplzBaseUrl(config.sandbox)}/collections/${config.collectionId}`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: getBillplzAuthHeader(config.apiKey)
    },
    cache: "no-store"
  });

  const data = (await response.json()) as {
    id?: string;
    title?: string;
    status?: string;
    error?: { message?: string };
  };

  if (!response.ok || !data.id) {
    throw new Error(data.error?.message ?? "Unable to reach Billplz collection.");
  }

  return {
    id: data.id,
    title: data.title ?? "",
    status: data.status ?? "unknown"
  } satisfies BillplzCollection;
}

function signBillplzParts(parts: string[], xSignatureKey: string) {
  return createHmac("sha256", xSignatureKey).update(parts.join("|")).digest("hex");
}

export function verifyBillplzRedirectSignature(
  params: Record<string, string>,
  xSignatureKey: string | undefined
) {
  const signature = params["billplz[x_signature]"];

  if (!xSignatureKey || !signature) {
    return false;
  }

  const parts = Object.entries(params)
    .filter(([key, value]) => key !== "billplz[x_signature]" && value.length > 0)
    .map(([key, value]) => `${key.replace(/[^a-z0-9_]+/gi, "")}${value}`)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

  return signBillplzParts(parts, xSignatureKey) === signature;
}

export function verifyBillplzCallbackSignature(
  params: Record<string, string>,
  xSignatureKey: string | undefined
) {
  const signature = params.x_signature;

  if (!xSignatureKey || !signature) {
    return false;
  }

  const parts = Object.entries(params)
    .filter(([key]) => key !== "x_signature")
    .map(([key, value]) => `${key}${value}`)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

  return signBillplzParts(parts, xSignatureKey) === signature;
}
