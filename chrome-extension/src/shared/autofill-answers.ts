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
    addAliases(answers, "do_you_require_sponsorship", [
      "require_sponsorship",
      "need_sponsorship",
      "visa_sponsorship",
      "immigration_sponsorship",
      "sponsorship_required",
      "require_visa_sponsorship",
      "need_visa_sponsorship",
      "employer_sponsorship",
      "future_sponsorship",
      "sponsorship_support",
    ]);
  }

  addAliases(answers, "linkedin_url", ["linkedin", "linkedin_profile"]);
  addAliases(answers, "github_url", ["github", "github_profile"]);
  addAliases(answers, "portfolio_url", ["portfolio", "website"]);
  addAliases(answers, "phone", [
    "phone_number",
    "mobile_number",
    "telephone",
    "cell_phone",
    "mobile",
    "contact_number",
  ]);
  addAliases(answers, "email", ["email_address", "contact_email"]);
  addAliases(answers, "work_authorization", [
    "authorized_to_work",
    "legally_authorized_to_work",
    "legally_authorized_to_work_in",
    "authorized_to_work_in_the_united_states",
    "legally_authorized",
    "work_eligibility",
    "employment_eligibility",
    "right_to_work",
  ]);
  addAliases(answers, "are_you_authorized_to_work", [
    "legally_authorized_to_work",
    "authorized_to_work_in_the_united_states",
    "legally_authorized",
    "work_eligibility",
    "employment_eligibility",
    "right_to_work",
  ]);

  addAliases(answers, "full_name", ["legal_name", "preferred_name", "name"]);
  addAliases(answers, "first_name", ["given_name"]);
  addAliases(answers, "last_name", ["family_name", "surname"]);
  addAliases(answers, "address_line1", ["street_address", "address"]);
  addAliases(answers, "zip_code", ["zip", "zipcode"]);
  addAliases(answers, "university", ["school", "school_name", "college", "institution"]);
  addAliases(answers, "field_of_study", ["major"]);
  addAliases(answers, "degree", [
    "degree_type",
    "education_level",
    "highest_education",
    "education_completed",
    "level_of_education",
  ]);
  addAliases(answers, "expected_salary", [
    "desired_salary",
    "salary_expectation",
    "compensation",
    "desired_compensation",
    "salary_requirement",
    "minimum_salary",
    "salary_requirements",
    "minimum_salary_requirements",
  ]);
  addAliases(answers, "ethnicity", ["race", "race_ethnicity"]);
  addAliases(answers, "gender", ["sex"]);
  addAliases(answers, "veteran_status", ["veteran"]);
  addAliases(answers, "disability_status", ["disability"]);
  addAliases(answers, "years_of_experience", ["total_experience", "experience"]);
  addAliases(answers, "current_title", ["job_title", "title"]);
  addAliases(answers, "current_company", ["company", "employer", "current_employer"]);

  const custom = profile.custom_fields;
  if (custom && typeof custom === "object") {
    for (const [key, value] of Object.entries(custom)) {
      flattenCustomFields(answers, key, value);
    }
  }

  // Universal eligibility: job applicants must be 18+ to apply via typical portals.
  setAnswer(answers, "are_you_18", "Yes");
  addAliases(answers, "are_you_18", [
    "18_years_of_age",
    "age_or_older",
    "over_18",
    "age_18_or_older",
    "over_18_years_of_age",
  ]);

  return answers;
}
