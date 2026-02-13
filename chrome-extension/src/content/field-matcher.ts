/**
 * State B: Field → Profile Matching — Maps form fields to profile values
 * with confidence tiers: high (auto-fill), medium (preview/undo), low (ask user).
 */

import type { UserProfile } from "@/shared/types";
import type { FormField } from "@/shared/types";

// ---------------------------------------------------------------------------
// High confidence: deterministic mapping (autocomplete, type, known ids)
// ---------------------------------------------------------------------------

const AUTOCOMPLETE_MAP: Record<string, string> = {
  "given-name": "first_name",
  "family-name": "last_name",
  "name": "full_name",
  "email": "email",
  "tel": "phone",
  "street-address": "address_line1",
  "address-line2": "address_line2",
  "address-level2": "city",
  "address-level1": "state",
  "postal-code": "zip_code",
  "country": "country",
};

const KNOWN_ID_NAME_MAP: Record<string, string> = {
  email: "email",
  "user-email": "email",
  "applicant-email": "email",
  "e-mail": "email",
  "first-name": "first_name",
  firstname: "first_name",
  "first_name": "first_name",
  fname: "first_name",
  "last-name": "last_name",
  lastname: "last_name",
  "last_name": "last_name",
  lname: "last_name",
  "full-name": "full_name",
  fullname: "full_name",
  name: "full_name",
  phone: "phone",
  telephone: "phone",
  mobile: "phone",
  "phone-number": "phone",
  address: "address_line1",
  city: "city",
  state: "state",
  zip: "zip_code",
  "zip-code": "zip_code",
  postal: "zip_code",
  country: "country",
  linkedin: "linkedin_url",
  github: "github_url",
  portfolio: "portfolio_url",
  website: "portfolio_url",
};

// ---------------------------------------------------------------------------
// Label patterns (medium/high confidence depending on specificity)
// ---------------------------------------------------------------------------

const FIELD_PATTERNS: Record<string, RegExp[]> = {
  first_name: [/first.?name/i, /given.?name/i, /fname/i, /^first$/i, /prenom/i],
  last_name: [/last.?name/i, /sur.?name/i, /family.?name/i, /lname/i, /^last$/i],
  full_name: [/full.?name/i, /^name$/i, /your.?name/i, /legal.?name/i, /candidate.?name/i],
  email: [/e.?mail/i, /email.?address/i, /^email$/i],
  phone: [/phone/i, /mobile/i, /cell/i, /tel/i, /contact.?number/i],
  address_line1: [/address.?line.?1/i, /street.?address/i, /^address$/i, /mailing.?address/i],
  address_line2: [/address.?line.?2/i, /apt/i, /suite/i, /unit/i],
  city: [/^city$/i, /city.?name/i, /town/i],
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

// Low confidence: do not auto-fill
const LOW_CONFIDENCE_PATTERNS = [
  /id.?number/i,
  /employee.?code/i,
  /linkedin.?headline/i,
  /headline/i,
  /employee.?id/i,
  /reference/i,
];

// ---------------------------------------------------------------------------
// Profile value resolver
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Matching logic
// ---------------------------------------------------------------------------

export type ConfidenceTier = "high" | "medium" | "low";

function matchFieldType(signals: string[]): { fieldType: string; confidence: number; tier: ConfidenceTier } | null {
  const combined = signals.join(" ");

  // Low confidence — do not fill
  if (LOW_CONFIDENCE_PATTERNS.some((p) => p.test(combined))) {
    return null;
  }

  // High confidence: direct autocomplete value in signals (e.g. "email", "given-name")
  for (const signal of signals) {
    const key = signal.toLowerCase().trim();
    if (AUTOCOMPLETE_MAP[key]) {
      return { fieldType: AUTOCOMPLETE_MAP[key], confidence: 0.95, tier: "high" };
    }
  }

  // High confidence: input type=email
  if (signals.some((s) => s.toLowerCase() === "type:email")) {
    return { fieldType: "email", confidence: 0.95, tier: "high" };
  }

  // High confidence: known id/name
  for (const signal of signals) {
    const normalized = signal.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    const key = Object.keys(KNOWN_ID_NAME_MAP).find(
      (k) => normalized === k || normalized.includes(k) || signal.toLowerCase() === k
    );
    if (key) {
      return { fieldType: KNOWN_ID_NAME_MAP[key], confidence: 0.9, tier: "high" };
    }
  }

  // Label patterns
  let bestMatch: { fieldType: string; confidence: number; tier: ConfidenceTier } | null = null;

  for (const [fieldType, patterns] of Object.entries(FIELD_PATTERNS)) {
    for (const pattern of patterns) {
      for (const signal of signals) {
        if (pattern.test(signal)) {
          // Short signals (name, id) = high; parent text = medium
          const confidence = signal.length < 50 ? 0.85 : 0.65;
          const tier: ConfidenceTier = confidence >= 0.8 ? "high" : confidence >= 0.6 ? "medium" : "low";
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = { fieldType, confidence, tier };
          }
        }
      }
    }
  }

  return bestMatch;
}

// ---------------------------------------------------------------------------
// Main API: match fields to profile
// ---------------------------------------------------------------------------

export function matchFieldsToProfile(
  fields: FormField[],
  profile: UserProfile
): FormField[] {
  return fields.map((field) => {
    const match = matchFieldType(field.signals);

    if (!match) {
      return {
        ...field,
        fieldType: "unknown",
        confidence: 0,
        confidenceTier: "low" as const,
        profileValue: null,
      };
    }

    const profileValue = resolveProfileValue(match.fieldType, profile);

    return {
      ...field,
      fieldType: match.fieldType,
      confidence: match.confidence,
      confidenceTier: match.tier,
      profileValue: profileValue ?? null,
    };
  });
}
