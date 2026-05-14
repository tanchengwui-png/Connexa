export const RULE_MATCH_OPERATORS = {
  CONTAINS_WORD: "CONTAINS_WORD",
  CONTAINS_ANY_WORDS: "CONTAINS_ANY_WORDS",
  EXACTLY_MATCHES: "EXACTLY_MATCHES",
  STARTS_WITH: "STARTS_WITH",
  ENDS_WITH: "ENDS_WITH",
  HAS_NUMBER: "HAS_NUMBER",
  HAS_PHONE_NUMBER: "HAS_PHONE_NUMBER",
  HAS_EMAIL: "HAS_EMAIL",
  MESSAGE_LANGUAGE_IS: "MESSAGE_LANGUAGE_IS",
  CUSTOMER_HAS_NOT_REPLIED_BEFORE: "CUSTOMER_HAS_NOT_REPLIED_BEFORE",
  OUTSIDE_BUSINESS_HOURS: "OUTSIDE_BUSINESS_HOURS",
  REGEX: "REGEX"
} as const;

export type RuleMatchOperator = (typeof RULE_MATCH_OPERATORS)[keyof typeof RULE_MATCH_OPERATORS];
export const RULE_LANGUAGE_OPTIONS = [
  { value: "english", label: "English" },
  { value: "malay", label: "Malay" },
  { value: "chinese", label: "Chinese" }
] as const;

export type RuleLanguageOption = (typeof RULE_LANGUAGE_OPTIONS)[number]["value"];

export const RULE_MATCH_OPERATOR_OPTIONS: Array<{
  value: RuleMatchOperator;
  label: string;
  needsValue: boolean;
  placeholder?: string;
}> = [
  {
    value: RULE_MATCH_OPERATORS.CONTAINS_WORD,
    label: "Contains word",
    needsValue: true,
    placeholder: "price"
  },
  {
    value: RULE_MATCH_OPERATORS.CONTAINS_ANY_WORDS,
    label: "Contains any of these words",
    needsValue: true,
    placeholder: "price, cost, quotation"
  },
  {
    value: RULE_MATCH_OPERATORS.EXACTLY_MATCHES,
    label: "Exactly matches",
    needsValue: true,
    placeholder: "hi"
  },
  {
    value: RULE_MATCH_OPERATORS.STARTS_WITH,
    label: "Starts with",
    needsValue: true,
    placeholder: "hello"
  },
  {
    value: RULE_MATCH_OPERATORS.ENDS_WITH,
    label: "Ends with",
    needsValue: true,
    placeholder: "thank you"
  },
  {
    value: RULE_MATCH_OPERATORS.HAS_NUMBER,
    label: "Has number",
    needsValue: false
  },
  {
    value: RULE_MATCH_OPERATORS.HAS_PHONE_NUMBER,
    label: "Has phone number",
    needsValue: false
  },
  {
    value: RULE_MATCH_OPERATORS.HAS_EMAIL,
    label: "Has email",
    needsValue: false
  },
  {
    value: RULE_MATCH_OPERATORS.MESSAGE_LANGUAGE_IS,
    label: "Message appears to be in language",
    needsValue: true,
    placeholder: "English"
  },
  {
    value: RULE_MATCH_OPERATORS.CUSTOMER_HAS_NOT_REPLIED_BEFORE,
    label: "Customer has not replied before",
    needsValue: false
  },
  {
    value: RULE_MATCH_OPERATORS.OUTSIDE_BUSINESS_HOURS,
    label: "Outside business hours",
    needsValue: false
  },
  {
    value: RULE_MATCH_OPERATORS.REGEX,
    label: "Regex (advanced)",
    needsValue: true,
    placeholder: "^(hi|hello)$"
  }
];

const KEYWORD_PREFIXES = {
  CONTAINS_WORD: "word:",
  CONTAINS_ANY_WORDS: "any:",
  STARTS_WITH: "starts:",
  ENDS_WITH: "ends:",
  MESSAGE_LANGUAGE_IS: "lang:",
  BUILTIN: "builtin:"
} as const;

const BUILTIN_VALUES = {
  HAS_NUMBER: "has_number",
  HAS_PHONE_NUMBER: "has_phone_number",
  HAS_EMAIL: "has_email",
  CUSTOMER_HAS_NOT_REPLIED_BEFORE: "customer_has_not_replied_before",
  OUTSIDE_BUSINESS_HOURS: "outside_business_hours"
} as const;

export function encodeRuleMatcher(input: {
  operator: RuleMatchOperator;
  value: string;
}): { matchType: "CONTAINS" | "EXACT" | "REGEX"; keyword: string } {
  const normalizedValue = input.value.trim();

  switch (input.operator) {
    case RULE_MATCH_OPERATORS.EXACTLY_MATCHES:
      return { matchType: "EXACT", keyword: normalizedValue };
    case RULE_MATCH_OPERATORS.REGEX:
      return { matchType: "REGEX", keyword: normalizedValue };
    case RULE_MATCH_OPERATORS.CONTAINS_WORD:
      return { matchType: "CONTAINS", keyword: `${KEYWORD_PREFIXES.CONTAINS_WORD}${normalizedValue}` };
    case RULE_MATCH_OPERATORS.CONTAINS_ANY_WORDS:
      return { matchType: "CONTAINS", keyword: `${KEYWORD_PREFIXES.CONTAINS_ANY_WORDS}${normalizedValue}` };
    case RULE_MATCH_OPERATORS.STARTS_WITH:
      return { matchType: "CONTAINS", keyword: `${KEYWORD_PREFIXES.STARTS_WITH}${normalizedValue}` };
    case RULE_MATCH_OPERATORS.ENDS_WITH:
      return { matchType: "CONTAINS", keyword: `${KEYWORD_PREFIXES.ENDS_WITH}${normalizedValue}` };
    case RULE_MATCH_OPERATORS.MESSAGE_LANGUAGE_IS:
      return { matchType: "CONTAINS", keyword: `${KEYWORD_PREFIXES.MESSAGE_LANGUAGE_IS}${normalizedValue}` };
    case RULE_MATCH_OPERATORS.HAS_NUMBER:
      return {
        matchType: "CONTAINS",
        keyword: `${KEYWORD_PREFIXES.BUILTIN}${BUILTIN_VALUES.HAS_NUMBER}`
      };
    case RULE_MATCH_OPERATORS.HAS_PHONE_NUMBER:
      return {
        matchType: "CONTAINS",
        keyword: `${KEYWORD_PREFIXES.BUILTIN}${BUILTIN_VALUES.HAS_PHONE_NUMBER}`
      };
    case RULE_MATCH_OPERATORS.HAS_EMAIL:
      return {
        matchType: "CONTAINS",
        keyword: `${KEYWORD_PREFIXES.BUILTIN}${BUILTIN_VALUES.HAS_EMAIL}`
      };
    case RULE_MATCH_OPERATORS.CUSTOMER_HAS_NOT_REPLIED_BEFORE:
      return {
        matchType: "CONTAINS",
        keyword: `${KEYWORD_PREFIXES.BUILTIN}${BUILTIN_VALUES.CUSTOMER_HAS_NOT_REPLIED_BEFORE}`
      };
    case RULE_MATCH_OPERATORS.OUTSIDE_BUSINESS_HOURS:
      return {
        matchType: "CONTAINS",
        keyword: `${KEYWORD_PREFIXES.BUILTIN}${BUILTIN_VALUES.OUTSIDE_BUSINESS_HOURS}`
      };
    default:
      return { matchType: "CONTAINS", keyword: normalizedValue };
  }
}

export function decodeRuleMatcher(matchType: string, keyword: string | null | undefined): {
  operator: RuleMatchOperator;
  value: string;
} {
  const value = keyword?.trim() ?? "";

  if (matchType === "EXACT") {
    return {
      operator: RULE_MATCH_OPERATORS.EXACTLY_MATCHES,
      value
    };
  }

  if (matchType === "REGEX") {
    return {
      operator: RULE_MATCH_OPERATORS.REGEX,
      value
    };
  }

  if (value.startsWith(KEYWORD_PREFIXES.CONTAINS_WORD)) {
    return {
      operator: RULE_MATCH_OPERATORS.CONTAINS_WORD,
      value: value.slice(KEYWORD_PREFIXES.CONTAINS_WORD.length)
    };
  }

  if (value.startsWith(KEYWORD_PREFIXES.CONTAINS_ANY_WORDS)) {
    return {
      operator: RULE_MATCH_OPERATORS.CONTAINS_ANY_WORDS,
      value: value.slice(KEYWORD_PREFIXES.CONTAINS_ANY_WORDS.length)
    };
  }

  if (value.startsWith(KEYWORD_PREFIXES.STARTS_WITH)) {
    return {
      operator: RULE_MATCH_OPERATORS.STARTS_WITH,
      value: value.slice(KEYWORD_PREFIXES.STARTS_WITH.length)
    };
  }

  if (value.startsWith(KEYWORD_PREFIXES.ENDS_WITH)) {
    return {
      operator: RULE_MATCH_OPERATORS.ENDS_WITH,
      value: value.slice(KEYWORD_PREFIXES.ENDS_WITH.length)
    };
  }

  if (value.startsWith(KEYWORD_PREFIXES.MESSAGE_LANGUAGE_IS)) {
    return {
      operator: RULE_MATCH_OPERATORS.MESSAGE_LANGUAGE_IS,
      value: value.slice(KEYWORD_PREFIXES.MESSAGE_LANGUAGE_IS.length)
    };
  }

  if (value === `${KEYWORD_PREFIXES.BUILTIN}${BUILTIN_VALUES.HAS_NUMBER}`) {
    return {
      operator: RULE_MATCH_OPERATORS.HAS_NUMBER,
      value: ""
    };
  }

  if (value === `${KEYWORD_PREFIXES.BUILTIN}${BUILTIN_VALUES.HAS_PHONE_NUMBER}`) {
    return {
      operator: RULE_MATCH_OPERATORS.HAS_PHONE_NUMBER,
      value: ""
    };
  }

  if (value === `${KEYWORD_PREFIXES.BUILTIN}${BUILTIN_VALUES.HAS_EMAIL}`) {
    return {
      operator: RULE_MATCH_OPERATORS.HAS_EMAIL,
      value: ""
    };
  }

  if (value === `${KEYWORD_PREFIXES.BUILTIN}${BUILTIN_VALUES.CUSTOMER_HAS_NOT_REPLIED_BEFORE}`) {
    return {
      operator: RULE_MATCH_OPERATORS.CUSTOMER_HAS_NOT_REPLIED_BEFORE,
      value: ""
    };
  }

  if (value === `${KEYWORD_PREFIXES.BUILTIN}${BUILTIN_VALUES.OUTSIDE_BUSINESS_HOURS}`) {
    return {
      operator: RULE_MATCH_OPERATORS.OUTSIDE_BUSINESS_HOURS,
      value: ""
    };
  }

  return {
    operator: RULE_MATCH_OPERATORS.CONTAINS_WORD,
    value
  };
}

export function getRuleOperatorLabel(operator: RuleMatchOperator) {
  return RULE_MATCH_OPERATOR_OPTIONS.find((option) => option.value === operator)?.label ?? "Contains word";
}

export function formatRuleMatcherValue(matchType: string, keyword: string | null | undefined) {
  const matcher = decodeRuleMatcher(matchType, keyword);
  return matcher.value;
}
