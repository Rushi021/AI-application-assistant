import type { UserProfile } from "@/shared/types";

export type AutofillAnswerMap = Record<string, string>;

function normalizeAnswerKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toAnswerValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return null;
}

function setAnswer(target: AutofillAnswerMap, key: string, value: unknown): void {
  const normalizedKey = normalizeAnswerKey(key);
  if (!normalizedKey) return;
  const answerValue = toAnswerValue(value);
  if (!answerValue) return;
  target[normalizedKey] = answerValue;
}

function addAliases(target: AutofillAnswerMap, key: string, aliases: string[]): void {
  const base = target[normalizeAnswerKey(key)];
  if (!base) return;
  for (const alias of aliases) {
    setAnswer(target, alias, base);
  }
}

function flattenCustomFields(
  target: AutofillAnswerMap,
  prefix: string,
  value: unknown
): void {
  if (value == null) return;

  if (Array.isArray(value)) {
    value.forEach((entry, idx) => {
      flattenCustomFields(target, `${prefix}_${idx + 1}`, entry);
    });
    return;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      flattenCustomFields(target, `${prefix}_${k}`, v);
    }
    return;
  }

  setAnswer(target, prefix, value);
}

export function buildAutofillAnswersFromProfile(profile: UserProfile | null | undefined): AutofillAnswerMap {
  if (!profile) return {};

  const answers: AutofillAnswerMap = {};
  const fullName = profile.full_name?.trim() ?? "";
  const [firstName = "", ...rest] = fullName.split(/\s+/).filter(Boolean);
  const lastName = rest.join(" ").trim();

  const basePairs: Array<[string, unknown]> = [
    ["full_name", profile.full_name],
    ["first_name", firstName],
    ["last_name", lastName],
    ["email", profile.email],
    ["phone", profile.phone],
    ["address_line1", profile.address_line1],
    ["address_line2", profile.address_line2],
    ["city", profile.city],
    ["state", profile.state],
    ["zip_code", profile.zip_code],
    ["postal_code", profile.zip_code],
    ["country", profile.country],
    ["linkedin_url", profile.linkedin_url],
    ["portfolio_url", profile.portfolio_url],
    ["github_url", profile.github_url],
    ["years_of_experience", profile.years_of_experience],
    ["current_title", profile.current_title],
    ["current_company", profile.current_company],
    ["degree", profile.degree],
    ["field_of_study", profile.field_of_study],
    ["university", profile.university],
    ["graduation_year", profile.graduation_year],
    ["gpa", profile.gpa],
    ["visa_status", profile.visa_status],
    ["work_authorization", profile.work_authorization],
    ["sponsorship_needed", profile.sponsorship_needed],
    ["gender", profile.gender],
    ["ethnicity", profile.ethnicity],
    ["veteran_status", profile.veteran_status],
    ["disability_status", profile.disability_status],
    ["expected_salary", profile.expected_salary],
    ["current_salary", profile.current_salary],
    ["salary_currency", profile.salary_currency],
  ];

  for (const [key, value] of basePairs) {
    setAnswer(answers, key, value);
  }

  setAnswer(answers, "are_you_authorized_to_work", profile.work_authorization);
  if (profile.sponsorship_needed != null) {
    setAnswer(answers, "do_you_require_sponsorship", profile.sponsorship_needed ? "Yes" : "No");
  }

  addAliases(answers, "linkedin_url", ["linkedin", "linkedin_profile"]);
  addAliases(answers, "github_url", ["github", "github_profile"]);
  addAliases(answers, "portfolio_url", ["portfolio", "website"]);
  addAliases(answers, "phone", ["phone_number", "mobile_number"]);
  addAliases(answers, "work_authorization", ["authorized_to_work"]);

  const custom = profile.custom_fields;
  if (custom && typeof custom === "object") {
    for (const [key, value] of Object.entries(custom)) {
      flattenCustomFields(answers, key, value);
    }
  }

  return answers;
}
