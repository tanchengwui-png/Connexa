export function getAppBaseUrl() {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function resolveMediaAssetUrl(value: string) {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `${getAppBaseUrl()}${value.startsWith("/") ? value : `/${value}`}`;
}

export function toClientMediaUrl(value: string) {
  if (!/^https?:\/\//i.test(value)) {
    return value;
  }

  try {
    const parsed = new URL(value);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return value;
  }
}
