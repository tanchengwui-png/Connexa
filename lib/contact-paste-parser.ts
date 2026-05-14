import { MALAYSIA_POPULAR_LOCATIONS } from "@/lib/malaysia-popular-locations";
import { normalizeStoredPhone } from "@/lib/phone";

export type ParsedContactBlock = {
  displayName: string;
  phoneNumber: string;
  countryCode: string;
  isInternational: boolean;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

const MALAYSIA_STATE_ALIASES: Array<{ aliases: string[]; state: string }> = [
  { state: "Johor", aliases: ["johor", "jhr"] },
  { state: "Kedah", aliases: ["kedah"] },
  { state: "Kelantan", aliases: ["kelantan"] },
  { state: "Kuala Lumpur", aliases: ["kuala lumpur", "kl", "wilayah persekutuan kuala lumpur"] },
  { state: "Labuan", aliases: ["labuan", "wilayah persekutuan labuan"] },
  { state: "Melaka", aliases: ["melaka", "malacca"] },
  { state: "Negeri Sembilan", aliases: ["negeri sembilan", "ns"] },
  { state: "Pahang", aliases: ["pahang"] },
  { state: "Perak", aliases: ["perak"] },
  { state: "Perlis", aliases: ["perlis"] },
  { state: "Pulau Pinang", aliases: ["pulau pinang", "penang"] },
  { state: "Putrajaya", aliases: ["putrajaya", "wilayah persekutuan putrajaya"] },
  { state: "Sabah", aliases: ["sabah"] },
  { state: "Sarawak", aliases: ["sarawak"] },
  { state: "Selangor", aliases: ["selangor", "sgr"] },
  { state: "Terengganu", aliases: ["terengganu", "trg"] }
];

const MALAYSIA_CITY_SET = new Set(MALAYSIA_POPULAR_LOCATIONS.map((item) => item.name.toLowerCase()));

export function parseContactPasteBlock(raw: string): ParsedContactBlock {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const commaSegments = raw
    .split(",")
    .map((segment) => normalizeWhitespace(segment))
    .filter(Boolean);

  const detectedEmail = lines.find((line) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line)) ?? "";
  const phoneSource = lines.find((line) => extractPhoneDigits(line).length >= 8) ?? "";
  const phoneDigits = extractPhoneDigits(phoneSource);
  const { countryCode, phoneNumber, isInternational } = splitPhone(phoneDigits);

  const nameLine =
    lines.find(
      (line) =>
        line !== detectedEmail &&
        line !== phoneSource &&
        !looksLikeAddress(line) &&
        /[A-Za-z]/.test(line)
    ) ?? "";

  const country = detectCountry(lines, commaSegments);
  const state = detectState(lines, commaSegments);
  const postalCode = detectPostalCode(lines, commaSegments);
  const city = detectCity(lines, commaSegments, postalCode, state);

  const addressSegments = lines
    .filter((line) => line !== nameLine && line !== detectedEmail && line !== phoneSource)
    .flatMap((line) => splitAddressLine(line))
    .map((segment) => stripKnownLocationBits(segment, { postalCode, city, state, country }))
    .filter(Boolean);

  const [addressLine1 = "", addressLine2 = ""] = addressSegments;

  return {
    displayName: nameLine,
    phoneNumber,
    countryCode,
    isInternational,
    email: detectedEmail,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country
  };
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractPhoneDigits(value: string) {
  return normalizeStoredPhone(value);
}

function splitPhone(digits: string) {
  if (!digits) {
    return {
      countryCode: "60",
      phoneNumber: "",
      isInternational: false
    };
  }

  if (digits.startsWith("60") && digits.length >= 10) {
    return {
      countryCode: "60",
      phoneNumber: digits.slice(2),
      isInternational: true
    };
  }

  return {
    countryCode: "60",
    phoneNumber: digits.replace(/^0+/, ""),
    isInternational: false
  };
}

function looksLikeAddress(value: string) {
  const normalized = value.toLowerCase();
  return (
    /\d/.test(value) ||
    normalized.includes("jalan") ||
    normalized.includes("jln") ||
    normalized.includes("no ") ||
    normalized.includes("lorong") ||
    normalized.includes("taman") ||
    normalized.includes("unit") ||
    normalized.includes("blok") ||
    normalized.includes("block") ||
    normalized.includes("apartment") ||
    normalized.includes("residence")
  );
}

function detectCountry(lines: string[], commaSegments: string[]) {
  const countrySource = [...lines, ...commaSegments].find((value) =>
    /\bmalaysia\b/i.test(value)
  );
  return countrySource ? "Malaysia" : "";
}

function detectState(lines: string[], commaSegments: string[]) {
  const candidates = [...lines, ...commaSegments].map((value) => value.toLowerCase());
  for (const value of candidates) {
    for (const entry of MALAYSIA_STATE_ALIASES) {
      if (entry.aliases.some((alias) => value.includes(alias))) {
        return entry.state;
      }
    }
  }
  return "";
}

function detectPostalCode(lines: string[], commaSegments: string[]) {
  const source = [...lines, ...commaSegments].find((value) => /\b\d{5}\b/.test(value));
  return source?.match(/\b\d{5}\b/)?.[0] ?? "";
}

function detectCity(
  lines: string[],
  commaSegments: string[],
  postalCode: string,
  state: string
) {
  const candidates = [...lines, ...commaSegments];
  for (const candidate of candidates) {
    const cleaned = stripKnownLocationBits(candidate, {
      postalCode,
      state,
      country: "Malaysia",
      city: ""
    });
    if (!cleaned) {
      continue;
    }
    if (MALAYSIA_CITY_SET.has(cleaned.toLowerCase())) {
      return cleaned;
    }
    if (!/\d/.test(cleaned) && cleaned.split(" ").length <= 4 && cleaned.length >= 3) {
      if (
        !MALAYSIA_STATE_ALIASES.some((entry) =>
          entry.aliases.some((alias) => cleaned.toLowerCase().includes(alias))
        )
      ) {
        return cleaned;
      }
    }
  }
  return "";
}

function splitAddressLine(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return [] as string[];
  }
  return normalized
    .split(/\s*,\s*/)
    .map((segment) => normalizeWhitespace(segment))
    .filter(Boolean);
}

function stripKnownLocationBits(
  value: string,
  known: { postalCode?: string; city?: string; state?: string; country?: string }
) {
  let next = normalizeWhitespace(value);
  if (!next) {
    return "";
  }

  if (known.postalCode) {
    next = normalizeWhitespace(next.replace(new RegExp(`\\b${escapeRegExp(known.postalCode)}\\b`, "gi"), ""));
  }
  if (known.city) {
    next = normalizeWhitespace(next.replace(new RegExp(`\\b${escapeRegExp(known.city)}\\b`, "gi"), ""));
  }
  if (known.state) {
    next = normalizeWhitespace(next.replace(new RegExp(`\\b${escapeRegExp(known.state)}\\b`, "gi"), ""));
  }
  if (known.country) {
    next = normalizeWhitespace(next.replace(new RegExp(`\\b${escapeRegExp(known.country)}\\b`, "gi"), ""));
  }

  return next.replace(/^[-,]+|[-,]+$/g, "").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
