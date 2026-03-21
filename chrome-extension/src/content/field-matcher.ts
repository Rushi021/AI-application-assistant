/**
 * State B: Field → Profile Matching — Weighted scoring with Tier A/B/C.
 * Platform adapter results run first; generic matcher handles the rest.
 */

import type { UserProfile } from "@/shared/types";
import type { FormField } from "@/shared/types";
import { detectPlatform } from "./adapters";
import {
  lookupLearnedMapping,
  normalizeLabel,
} from "./site-learning";

/** Phase 3: re-enabled after generic two-pass matching is solid. */
const USE_PLATFORM_ADAPTERS = true;
/** Re-enable when core filling is solid. */
const USE_SITE_LEARNING = false;

export type ConfidenceTier = "A" | "B" | "C";

/** Pass 2: flat keyword → field type. full_name is fallback when first_name/last_name did not match. */
const FIELD_KEYWORD_MAP: Record<string, string[]> = {
  first_name: ["first name", "given name", "fname", "first"],
  last_name: ["last name", "family name", "surname", "lname", "last"],
  full_name: ["full name", "your name", "name"],
  email: ["email", "e-mail", "email address"],
  phone: ["phone", "telephone", "mobile", "cell", "phone number"],
  address_line1: ["street", "address line 1", "address", "street address"],
  city: ["city", "town", "municipality", "location city", "location (city)"],
  state: ["state", "province", "region"],
  zip_code: ["zip", "postal", "postcode", "zip code", "postal code"],
  country: ["country", "nation"],
  linkedin_url: ["linkedin", "linkedin url", "linkedin profile"],
  current_company: ["current company", "company name", "current employer", "employer"],
  current_title: ["current title", "job title", "current position", "title"],
  work_authorization: ["work authorization", "authorized to work", "legal right to work", "eligibility to work"],
  sponsorship_needed: ["sponsorship", "visa sponsorship", "require sponsorship", "sponsor"],
  years_of_experience: ["years of experience", "experience years", "years exp", "yoe"],
  expected_salary: ["salary", "expected salary", "desired salary", "compensation", "pay expectations"],
  gender: ["gender", "sex"],
  ethnicity: ["ethnicity", "race", "ethnic"],
  veteran_status: ["veteran", "military", "armed forces"],
  disability_status: ["disability", "accommodation"],
};

const SIGNAL_WEIGHTS: Record<string, number> = {
  autocomplete: 10,
  type: 8,
  platform_adapter: 9,
  learned_mapping: 9,
  "aria-label": 7,
  label: 7,
  name: 5,
  id: 4,
  placeholder: 4,
  nearby: 2,
};

const AUTOCOMPLETE_TO_FIELDTYPE: Record<string, string> = {
  "given-name": "first_name",
  "family-name": "last_name",
  name: "full_name",
  email: "email",
  tel: "phone",
  "street-address": "address_line1",
  "address-line2": "address_line2",
  "address-level2": "city",
  "address-level1": "state",
  "postal-code": "zip_code",
  country: "country",
};

const NEGATIVE_PATTERNS: RegExp[] = [
  /phone\s+device\s+type/i,
  /device\s+type/i,
  /email\s+preferences/i,
  /email\s+me/i,
  /marketing\s+email/i,
  /company\s+name/i,
  /employer\s+name/i,
  /referral\s+name/i,
  /name\s+of\s+referral/i,
  /id\s*\.?\s*number/i,
  /employee\s*\.?\s*code/i,
  /linkedin\s*\.?\s*headline/i,
  /headline/i,
  /employee\s*\.?\s*id/i,
  /reference/i,
];

const FIELD_PATTERNS: Record<string, RegExp[]> = {
  first_name: [/first.?name/i, /given.?name/i, /fname/i, /^first$/i, /prenom/i],
  last_name: [/last.?name/i, /sur.?name/i, /family.?name/i, /lname/i, /^last$/i],
  full_name: [/full.?name/i, /^name$/i, /your.?name/i, /legal.?name/i, /candidate.?name/i],
  email: [/e.?mail/i, /email.?address/i, /^email$/i],
  phone: [/phone/i, /mobile/i, /cell/i, /tel/i, /contact.?number/i],
  address_line1: [/address.?line.?1/i, /street.?address/i, /^address$/i, /mailing.?address/i],
  address_line2: [/address.?line.?2/i, /apt/i, /suite/i, /unit/i],
  city: [/^city$/i, /city.?name/i, /town/i, /location.*city/i, /city.*location/i, /^location\s*\(city\)\s*$/i],
  state: [/^state$/i, /province/i, /region/i],
  zip_code: [/zip/i, /postal/i, /post.?code/i],
  country: [/country/i, /nation/i],
  linkedin_url: [/linkedin/i, /linked.?in/i],
  portfolio_url: [/portfolio/i, /website/i, /personal.?site/i, /blog/i],
  github_url: [/github/i, /git.?hub/i],
  university: [/university/i, /school/i, /college/i, /institution/i, /alma.?mater/i],
  degree: [/degree/i, /education.?level/i, /highest.?degree/i],
  field_of_study: [/field.?of.?study/i, /major/i, /discipline/i, /concentration/i],
  graduation_year: [/graduat/i, /year.?of.?completion/i],
  gpa: [/gpa/i, /grade.?point/i, /cumulative/i],
  years_of_experience: [/years?.?of?.?exp/i, /experience.?years/i, /total.?exp/i],
  current_title: [/current.?title/i, /job.?title/i, /position/i, /role/i, /designation/i],
  current_company: [/current.?company/i, /employer/i, /current.?employer/i, /company.?name/i],
  visa_status: [/visa/i, /immigration/i],
  work_authorization: [/work.?auth/i, /authorized.?to.?work/i, /legal.?right/i, /eligib/i],
  sponsorship_needed: [/sponsor/i, /visa.?sponsor/i, /require.?sponsor/i],
  gender: [/gender/i, /sex/i],
  ethnicity: [/ethnic/i, /race/i, /racial/i],
  veteran_status: [/veteran/i, /military/i, /armed.?forces/i],
  disability_status: [/disabil/i, /handicap/i, /accommodation/i],
  expected_salary: [/salary/i, /compensation/i, /expected.?pay/i, /desired.?salary/i, /pay.?expectation/i],
  current_salary: [/current.?salary/i, /current.?compensation/i, /present.?salary/i],
};

export function resolveProfileValue(fieldType: string, profile: UserProfile): string | null {
  switch (fieldType) {
    case "first_name":
      return profile.full_name?.split(" ")[0] ?? null;
    case "last_name": {
      const parts = profile.full_name?.split(" ");
      return parts && parts.length > 1 ? parts.slice(1).join(" ") : null;
    }
    case "full_name":
      return profile.full_name ?? null;
    case "email":
      return profile.email ?? null;
    case "phone":
      return profile.phone ?? null;
    case "address_line1":
      return profile.address_line1 ?? null;
    case "address_line2":
      return profile.address_line2 ?? null;
    case "city":
      return profile.city ?? null;
    case "state":
      return profile.state ?? null;
    case "zip_code":
      return profile.zip_code ?? null;
    case "country":
      return profile.country ?? null;
    case "linkedin_url":
      return profile.linkedin_url ?? null;
    case "portfolio_url":
      return profile.portfolio_url ?? null;
    case "github_url":
      return profile.github_url ?? null;
    case "university":
      return profile.university ?? null;
    case "degree":
      return profile.degree ?? null;
    case "field_of_study":
      return profile.field_of_study ?? null;
    case "graduation_year":
      return profile.graduation_year?.toString() ?? null;
    case "gpa":
      return profile.gpa?.toString() ?? null;
    case "years_of_experience":
      return profile.years_of_experience?.toString() ?? null;
    case "current_title":
      return profile.current_title ?? null;
    case "current_company":
      return profile.current_company ?? null;
    case "visa_status":
      return profile.visa_status ?? null;
    case "work_authorization":
      return profile.work_authorization ?? null;
    case "sponsorship_needed":
      return profile.sponsorship_needed === null ? null : profile.sponsorship_needed ? "Yes" : "No";
    case "gender":
      return profile.gender ?? null;
    case "ethnicity":
      return profile.ethnicity ?? null;
    case "veteran_status":
      return profile.veteran_status ?? null;
    case "disability_status":
      return profile.disability_status ?? null;
    case "expected_salary":
      return profile.expected_salary ?? null;
    case "current_salary":
      return profile.current_salary ?? null;
    default:
      return null;
  }
}

function scoreField(
  field: FormField
): { fieldType: string; rawScore: number; normalizedScore: number; tier: ConfidenceTier; matchReason: string } | null {
  const combined = field.signals.join(" ").toLowerCase();

  if (NEGATIVE_PATTERNS.some((p) => p.test(combined))) {
    return null;
  }

  const src = field.signalsWithSource ?? field.signals.map((v) => ({ source: "nearby", value: v }));

  const scoresByFieldType: Record<string, { score: number; reason: string }> = {};

  for (const { source, value } of src) {
    const weight = SIGNAL_WEIGHTS[source] ?? 2;

    if (source === "autocomplete") {
      const ft = AUTOCOMPLETE_TO_FIELDTYPE[value.toLowerCase().trim()];
      if (ft) {
        scoresByFieldType[ft] = {
          score: (scoresByFieldType[ft]?.score ?? 0) + weight,
          reason: `autocomplete:${ft}`,
        };
      }
    } else if (source === "type" && (value === "email" || value === "tel")) {
      const ft = value === "email" ? "email" : "phone";
      scoresByFieldType[ft] = {
        score: (scoresByFieldType[ft]?.score ?? 0) + weight,
        reason: `type:${ft}`,
      };
    } else {
      for (const [fieldType, patterns] of Object.entries(FIELD_PATTERNS)) {
        for (const p of patterns) {
          if (p.test(value)) {
            const prev = scoresByFieldType[fieldType];
            const newScore = (prev?.score ?? 0) + weight;
            scoresByFieldType[fieldType] = {
              score: newScore,
              reason: prev && prev.score >= weight ? prev.reason : `${source}:${fieldType}`,
            };
            break;
          }
        }
      }
    }
  }

  const entries = Object.entries(scoresByFieldType);
  if (entries.length === 0) return null;

  const best = entries.reduce((a, b) => (a[1].score >= b[1].score ? a : b));
  const [fieldType, { score: rawScore, reason: matchReason }] = best;

  const maxPossible = 25;
  const normalizedScore = Math.min(100, Math.round((rawScore / maxPossible) * 100));

  const tier: ConfidenceTier =
    normalizedScore >= 80 ? "A" : normalizedScore >= 50 ? "B" : "C";

  return {
    fieldType,
    rawScore,
    normalizedScore,
    tier,
    matchReason,
  };
}

function applyAdapterMappings(
  fields: FormField[],
  profile: UserProfile
): Map<string, FormField> {
  const matched = new Map<string, FormField>();
  if (!USE_PLATFORM_ADAPTERS) return matched;

  const adapter = detectPlatform();
  if (!adapter) return matched;

  const mappings = adapter.getFieldMappings();

  for (const mapping of mappings) {
    let container: Element | null = null;
    try {
      container = document.querySelector(mapping.selector);
    } catch {
      continue;
    }
    if (!container) continue;

    for (const field of fields) {
      if (matched.has(field.selector)) continue;
      let fieldEl: Element | null = null;
      try {
        fieldEl = document.querySelector(field.selector);
      } catch {
        continue;
      }
      if (!fieldEl) continue;

      if (container === fieldEl || container.contains(fieldEl)) {
        const profileValue = resolveProfileValue(mapping.fieldType, profile);
        matched.set(field.selector, {
          ...field,
          fieldType: mapping.fieldType,
          confidence: 90,
          confidenceTier: "A" as const,
          profileValue: profileValue ?? null,
          matchReason: `adapter:${adapter.name}`,
        });
        break;
      }
    }
  }

  return matched;
}

async function applyLearnedMappings(
  fields: FormField[],
  profile: UserProfile
): Promise<Map<string, FormField>> {
  const matched = new Map<string, FormField>();
  if (!USE_SITE_LEARNING) return matched;

  for (const field of fields) {
    const labelNorm = normalizeLabel(field.label);
    const learned = await lookupLearnedMapping(field.selector, labelNorm);
    if (!learned) continue;

    const profileValue = resolveProfileValue(learned.fieldType, profile);
    matched.set(field.selector, {
      ...field,
      fieldType: learned.fieldType,
      confidence: 90,
      confidenceTier: "A" as const,
      profileValue: profileValue ?? null,
      matchReason: `learned:${learned.fieldType}`,
    });
  }

  return matched;
}

/** Pass 2: match by FIELD_KEYWORD_MAP. Prefer longer (more specific) keyword. full_name only if first_name/last_name did not match. */
function matchByKeywordMap(field: FormField): { fieldType: string; keyword: string } | null {
  const labelText = (field.signals.join(" ") || field.label || "").toLowerCase().trim();
  if (!labelText) return null;

  const firstKeywords = FIELD_KEYWORD_MAP.first_name ?? [];
  const lastKeywords = FIELD_KEYWORD_MAP.last_name ?? [];
  const labelMatchesFirst = firstKeywords.some((k) => labelText.includes(k));
  const labelMatchesLast = lastKeywords.some((k) => labelText.includes(k));

  let best: { fieldType: string; keyword: string } | null = null;

  for (const [fieldType, keywords] of Object.entries(FIELD_KEYWORD_MAP)) {
    if (fieldType === "full_name" && (labelMatchesFirst || labelMatchesLast)) continue;
    for (const keyword of keywords) {
      if (!labelText.includes(keyword)) continue;
      if (!best || keyword.length > best.keyword.length) {
        best = { fieldType, keyword };
      }
    }
  }

  return best;
}

export async function matchFieldsToProfile(
  fields: FormField[],
  profile: UserProfile
): Promise<FormField[]> {
  const adapterMatched = applyAdapterMappings(fields, profile);
  const learnedMatched = await applyLearnedMappings(fields, profile);

  return fields.map((field) => {
    const adapterResult = adapterMatched.get(field.selector);
    if (adapterResult) return adapterResult;
    const learnedResult = learnedMatched.get(field.selector);
    if (learnedResult) return learnedResult;

    const src = field.signalsWithSource ?? field.signals.map((v) => ({ source: "nearby", value: v }));
    for (const { source, value } of src) {
      if (source === "autocomplete") {
        const ft = AUTOCOMPLETE_TO_FIELDTYPE[value.toLowerCase().trim()];
        if (ft) {
          const profileValue = resolveProfileValue(ft, profile);
          return {
            ...field,
            fieldType: ft,
            confidence: 95,
            confidenceTier: "A" as const,
            profileValue: profileValue ?? null,
            matchReason: `autocomplete:${ft}`,
          };
        }
      }
      if (source === "type" && (value === "email" || value === "tel")) {
        const ft = value === "email" ? "email" : "phone";
        const profileValue = resolveProfileValue(ft, profile);
        return {
          ...field,
          fieldType: ft,
          confidence: 95,
          confidenceTier: "A" as const,
          profileValue: profileValue ?? null,
          matchReason: `type:${ft}`,
        };
      }
    }

    const keywordMatch = matchByKeywordMap(field);
    if (keywordMatch) {
      const profileValue = resolveProfileValue(keywordMatch.fieldType, profile);
      return {
        ...field,
        fieldType: keywordMatch.fieldType,
        confidence: 70,
        confidenceTier: "B" as const,
        profileValue: profileValue ?? null,
        matchReason: `keyword:${keywordMatch.keyword}`,
      };
    }

    const result = scoreField(field);

    if (!result) {
      return {
        ...field,
        fieldType: "unknown",
        confidence: 0,
        confidenceTier: "C" as const,
        profileValue: null,
      };
    }

    const profileValue = resolveProfileValue(result.fieldType, profile);

    return {
      ...field,
      fieldType: result.fieldType,
      confidence: result.normalizedScore,
      confidenceTier: result.tier,
      profileValue: profileValue ?? null,
      matchReason: result.matchReason,
    };
  });
}
