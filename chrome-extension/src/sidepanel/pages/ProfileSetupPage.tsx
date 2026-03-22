import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store";
import { updateProfile } from "../services/api";
import { STORAGE_KEYS } from "@/shared/constants";
import type { EducationHistoryEntry, UserProfile, WorkExperienceEntry } from "@/shared/types";

const STEPS = ["Basic Info", "Professional", "Education", "Work Auth", "Demographics", "Salary"];

function emptyEducationRow(): EducationHistoryEntry {
  return { university: "", degree: "", field_of_study: "", graduation_year: null, gpa: null };
}

function emptyWorkRow(): WorkExperienceEntry {
  return {
    job_title: "",
    company: "",
    location: "",
    start_month: "",
    start_year: "",
    end_month: "",
    end_year: "",
    description: "",
  };
}

function parseEducationRows(p: UserProfile | null): EducationHistoryEntry[] {
  const hist = p?.custom_fields?.education_history;
  if (Array.isArray(hist) && hist.length > 0) {
    return hist.map((row: Record<string, unknown>) => ({
      university: String(row.university ?? ""),
      degree: String(row.degree ?? ""),
      field_of_study: String(row.field_of_study ?? ""),
      graduation_year:
        row.graduation_year == null || row.graduation_year === ""
          ? null
          : typeof row.graduation_year === "number"
            ? row.graduation_year
            : parseInt(String(row.graduation_year), 10) || null,
      gpa:
        row.gpa == null || row.gpa === ""
          ? null
          : typeof row.gpa === "number"
            ? row.gpa
            : parseFloat(String(row.gpa)) || null,
    }));
  }
  return [
    {
      university: p?.university ?? "",
      degree: p?.degree ?? "",
      field_of_study: p?.field_of_study ?? "",
      graduation_year: p?.graduation_year ?? null,
      gpa: p?.gpa ?? null,
    },
  ];
}

function parseWorkRows(p: UserProfile | null): WorkExperienceEntry[] {
  const raw = p?.custom_fields?.work_experience;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((r: Record<string, unknown>) => ({
      job_title: String(r.job_title ?? ""),
      company: String(r.company ?? ""),
      location: String(r.location ?? ""),
      start_month: String(r.start_month ?? ""),
      start_year: String(r.start_year ?? ""),
      end_month: String(r.end_month ?? ""),
      end_year: String(r.end_year ?? ""),
      description: String(r.description ?? ""),
    }));
  }
  return [emptyWorkRow()];
}

function workRowHasContent(w: WorkExperienceEntry): boolean {
  return [w.job_title, w.company, w.location, w.start_month, w.start_year, w.end_month, w.end_year, w.description].some(
    (x) => String(x ?? "").trim().length > 0
  );
}

export default function ProfileSetupPage() {
  const { profile, setProfile, setPage } = useAppStore();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useRef(false);
  const [educationRows, setEducationRows] = useState<EducationHistoryEntry[]>(() => parseEducationRows(null));
  const [workRows, setWorkRows] = useState<WorkExperienceEntry[]>(() => [emptyWorkRow()]);

  const [form, setForm] = useState<Partial<UserProfile>>({
    full_name: profile?.full_name ?? "",
    phone: profile?.phone ?? "",
    email: profile?.email ?? "",
    address_line1: profile?.address_line1 ?? "",
    address_line2: profile?.address_line2 ?? "",
    city: profile?.city ?? "",
    state: profile?.state ?? "",
    zip_code: profile?.zip_code ?? "",
    country: profile?.country ?? "",
    linkedin_url: profile?.linkedin_url ?? "",
    portfolio_url: profile?.portfolio_url ?? "",
    github_url: profile?.github_url ?? "",
    years_of_experience: profile?.years_of_experience ?? null,
    current_title: profile?.current_title ?? "",
    current_company: profile?.current_company ?? "",
    visa_status: profile?.visa_status ?? "",
    work_authorization: profile?.work_authorization ?? "",
    sponsorship_needed: profile?.sponsorship_needed ?? null,
    gender: profile?.gender ?? "",
    ethnicity: profile?.ethnicity ?? "",
    veteran_status: profile?.veteran_status ?? "",
    disability_status: profile?.disability_status ?? "",
    expected_salary: profile?.expected_salary ?? "",
    current_salary: profile?.current_salary ?? "",
    salary_currency: profile?.salary_currency ?? "USD",
  });

  const updateField = (key: string, value: unknown) => {
    setForm((prev: Partial<UserProfile>) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (!profile || hydrated.current) return;
    setEducationRows(parseEducationRows(profile));
    setWorkRows(parseWorkRows(profile));
    setForm((prev) => ({
      ...prev,
      full_name: profile.full_name ?? "",
      phone: profile.phone ?? "",
      email: profile.email ?? "",
      address_line1: profile.address_line1 ?? "",
      address_line2: profile.address_line2 ?? "",
      city: profile.city ?? "",
      state: profile.state ?? "",
      zip_code: profile.zip_code ?? "",
      country: profile.country ?? "",
      linkedin_url: profile.linkedin_url ?? "",
      portfolio_url: profile.portfolio_url ?? "",
      github_url: profile.github_url ?? "",
      years_of_experience: profile.years_of_experience ?? null,
      current_title: profile.current_title ?? "",
      current_company: profile.current_company ?? "",
      visa_status: profile.visa_status ?? "",
      work_authorization: profile.work_authorization ?? "",
      sponsorship_needed: profile.sponsorship_needed ?? null,
      gender: profile.gender ?? "",
      ethnicity: profile.ethnicity ?? "",
      veteran_status: profile.veteran_status ?? "",
      disability_status: profile.disability_status ?? "",
      expected_salary: profile.expected_salary ?? "",
      current_salary: profile.current_salary ?? "",
      salary_currency: profile.salary_currency ?? "USD",
    }));
    hydrated.current = true;
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const firstEd = educationRows[0] ?? emptyEducationRow();
      const mergedCustom: Record<string, unknown> = {
        ...(profile?.custom_fields ?? {}),
        education_history: educationRows,
        work_experience: workRows.filter(workRowHasContent),
      };
      const payload: Partial<UserProfile> = {
        ...form,
        degree: firstEd.degree,
        field_of_study: firstEd.field_of_study,
        university: firstEd.university,
        graduation_year: firstEd.graduation_year,
        gpa: firstEd.gpa,
        custom_fields: mergedCustom,
      };
      const updated = await updateProfile(payload);
      setProfile(updated);
      await chrome.storage.local.set({ [STORAGE_KEYS.USER_PROFILE]: updated });
      setPage("job-description");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleSave();
    }
  };

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleSave();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-wf-bg text-wf-text">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-wf-border">
        <h1 className="text-lg font-bold text-wf-text">Complete your profile</h1>
        <p className="text-xs text-wf-muted mt-1">
          This info will be used to auto-fill job applications.
        </p>
        {/* Step indicator */}
        <div className="flex gap-1 mt-3">
          {STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(i)}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                i <= step ? "bg-primary-500" : "bg-wf-border"
              }`}
            />
          ))}
        </div>
        <p className="text-xs font-medium text-primary-400 mt-2">{STEPS[step]}</p>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {step === 0 && (
          <>
            <Input label="Full Name" value={form.full_name ?? ""} onChange={(v) => updateField("full_name", v)} />
            <Input label="Email" value={form.email ?? ""} onChange={(v) => updateField("email", v)} type="email" />
            <Input label="Phone" value={form.phone ?? ""} onChange={(v) => updateField("phone", v)} />
            <Input label="Address Line 1" value={form.address_line1 ?? ""} onChange={(v) => updateField("address_line1", v)} />
            <Input label="Address Line 2" value={form.address_line2 ?? ""} onChange={(v) => updateField("address_line2", v)} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="City" value={form.city ?? ""} onChange={(v) => updateField("city", v)} />
              <Input label="State" value={form.state ?? ""} onChange={(v) => updateField("state", v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Zip Code" value={form.zip_code ?? ""} onChange={(v) => updateField("zip_code", v)} />
              <Input label="Country" value={form.country ?? ""} onChange={(v) => updateField("country", v)} />
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <Input label="LinkedIn URL" value={form.linkedin_url ?? ""} onChange={(v) => updateField("linkedin_url", v)} />
            <Input label="Portfolio / Website" value={form.portfolio_url ?? ""} onChange={(v) => updateField("portfolio_url", v)} />
            <Input label="GitHub URL" value={form.github_url ?? ""} onChange={(v) => updateField("github_url", v)} />
            <Input label="Years of Experience" value={String(form.years_of_experience ?? "")} onChange={(v) => updateField("years_of_experience", v ? parseInt(v) : null)} type="number" />
            <Input label="Current Title" value={form.current_title ?? ""} onChange={(v) => updateField("current_title", v)} />
            <Input label="Current Company" value={form.current_company ?? ""} onChange={(v) => updateField("current_company", v)} />
            <p className="text-xs text-wf-muted pt-2">
              Work history (used for experience / internship sections on applications). Add one block per role.
            </p>
            {workRows.map((row, i) => (
              <div key={i} className="rounded-[10px] border border-wf-border p-3 space-y-2 bg-wf-surface/40">
                <p className="text-xs font-semibold text-wf-text">Experience {i + 1}</p>
                <Input label="Job Title" value={row.job_title} onChange={(v) => {
                  const next = [...workRows];
                  next[i] = { ...next[i], job_title: v };
                  setWorkRows(next);
                }} />
                <Input label="Company" value={row.company} onChange={(v) => {
                  const next = [...workRows];
                  next[i] = { ...next[i], company: v };
                  setWorkRows(next);
                }} />
                <Input label="Location" value={row.location} onChange={(v) => {
                  const next = [...workRows];
                  next[i] = { ...next[i], location: v };
                  setWorkRows(next);
                }} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Start month" value={row.start_month} onChange={(v) => {
                    const next = [...workRows];
                    next[i] = { ...next[i], start_month: v };
                    setWorkRows(next);
                  }} placeholder="e.g. 6" />
                  <Input label="Start year" value={row.start_year} onChange={(v) => {
                    const next = [...workRows];
                    next[i] = { ...next[i], start_year: v };
                    setWorkRows(next);
                  }} placeholder="e.g. 2024" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="End month" value={row.end_month} onChange={(v) => {
                    const next = [...workRows];
                    next[i] = { ...next[i], end_month: v };
                    setWorkRows(next);
                  }} placeholder="e.g. 8" />
                  <Input label="End year" value={row.end_year} onChange={(v) => {
                    const next = [...workRows];
                    next[i] = { ...next[i], end_year: v };
                    setWorkRows(next);
                  }} placeholder="e.g. 2025" />
                </div>
                <label className="block">
                  <span className="text-xs font-medium text-wf-muted">Role description</span>
                  <textarea
                    value={row.description}
                    onChange={(e) => {
                      const next = [...workRows];
                      next[i] = { ...next[i], description: e.target.value };
                      setWorkRows(next);
                    }}
                    rows={3}
                    className="mt-1 block w-full rounded-[10px] border border-wf-border bg-wf-surface px-3 py-2 text-sm text-wf-text placeholder:text-wf-dim focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30 outline-none"
                    placeholder="Key accomplishments, technologies, impact…"
                  />
                </label>
                {workRows.length > 1 && (
                  <button
                    type="button"
                    className="text-xs text-red-400 hover:underline"
                    onClick={() => setWorkRows((rows) => rows.filter((_, j) => j !== i))}
                  >
                    Remove this experience
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setWorkRows((rows) => [...rows, emptyWorkRow()])}
              className="w-full py-2 text-sm border border-dashed border-wf-border rounded-[10px] text-wf-muted hover:text-wf-text"
            >
              + Add another experience
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <p className="text-xs text-wf-muted">
              Add each school where you earned a degree or credits. GPA is saved per school for accurate autofill.
            </p>
            {educationRows.map((row, i) => (
              <div key={i} className="rounded-[10px] border border-wf-border p-3 space-y-2 bg-wf-surface/40">
                <p className="text-xs font-semibold text-wf-text">School {i + 1}</p>
                <Input
                  label="Degree"
                  value={row.degree}
                  onChange={(v) => {
                    const next = [...educationRows];
                    next[i] = { ...next[i], degree: v };
                    setEducationRows(next);
                  }}
                  placeholder="e.g. Master of Science"
                />
                <Input
                  label="Field of Study"
                  value={row.field_of_study}
                  onChange={(v) => {
                    const next = [...educationRows];
                    next[i] = { ...next[i], field_of_study: v };
                    setEducationRows(next);
                  }}
                  placeholder="e.g. Computer Science"
                />
                <Input
                  label="University"
                  value={row.university}
                  onChange={(v) => {
                    const next = [...educationRows];
                    next[i] = { ...next[i], university: v };
                    setEducationRows(next);
                  }}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Graduation year"
                    value={String(row.graduation_year ?? "")}
                    onChange={(v) => {
                      const next = [...educationRows];
                      next[i] = { ...next[i], graduation_year: v ? parseInt(v, 10) : null };
                      setEducationRows(next);
                    }}
                    type="number"
                  />
                  <Input
                    label="GPA"
                    value={String(row.gpa ?? "")}
                    onChange={(v) => {
                      const next = [...educationRows];
                      next[i] = { ...next[i], gpa: v ? parseFloat(v) : null };
                      setEducationRows(next);
                    }}
                    type="number"
                    placeholder="e.g. 3.82 or 8.52"
                  />
                </div>
                {educationRows.length > 1 && (
                  <button
                    type="button"
                    className="text-xs text-red-400 hover:underline"
                    onClick={() => setEducationRows((rows) => rows.filter((_, j) => j !== i))}
                  >
                    Remove this school
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setEducationRows((rows) => [...rows, emptyEducationRow()])}
              className="w-full py-2 text-sm border border-dashed border-wf-border rounded-[10px] text-wf-muted hover:text-wf-text"
            >
              + Add another school
            </button>
          </>
        )}
        {step === 3 && (
          <>
            <Input label="Visa Status" value={form.visa_status ?? ""} onChange={(v) => updateField("visa_status", v)} placeholder="e.g. F-1, H-1B, Green Card" />
            <Input label="Work Authorization" value={form.work_authorization ?? ""} onChange={(v) => updateField("work_authorization", v)} placeholder="e.g. Authorized to work in US" />
            <Select
              label="Sponsorship Needed?"
              value={form.sponsorship_needed === null ? "" : form.sponsorship_needed ? "yes" : "no"}
              options={[
                { value: "", label: "Select..." },
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
              onChange={(v) => updateField("sponsorship_needed", v === "" ? null : v === "yes")}
            />
          </>
        )}
        {step === 4 && (
          <>
            <Select
              label="Gender"
              value={form.gender ?? ""}
              options={[
                { value: "", label: "Prefer not to say" },
                { value: "male", label: "Male" },
                { value: "female", label: "Female" },
                { value: "non-binary", label: "Non-binary" },
                { value: "other", label: "Other" },
              ]}
              onChange={(v) => updateField("gender", v)}
            />
            <Input label="Ethnicity" value={form.ethnicity ?? ""} onChange={(v) => updateField("ethnicity", v)} placeholder="e.g. Hispanic or Latino" />
            <Select
              label="Veteran Status"
              value={form.veteran_status ?? ""}
              options={[
                { value: "", label: "Prefer not to say" },
                { value: "veteran", label: "Veteran" },
                { value: "not-veteran", label: "Not a veteran" },
              ]}
              onChange={(v) => updateField("veteran_status", v)}
            />
            <Select
              label="Disability Status"
              value={form.disability_status ?? ""}
              options={[
                { value: "", label: "Prefer not to say" },
                { value: "yes", label: "Yes, I have a disability" },
                { value: "no", label: "No" },
              ]}
              onChange={(v) => updateField("disability_status", v)}
            />
          </>
        )}
        {step === 5 && (
          <>
            <Input label="Expected Salary" value={form.expected_salary ?? ""} onChange={(v) => updateField("expected_salary", v)} placeholder="e.g. 120000" />
            <Input label="Current Salary" value={form.current_salary ?? ""} onChange={(v) => updateField("current_salary", v)} placeholder="e.g. 100000" />
            <Select
              label="Currency"
              value={form.salary_currency ?? "USD"}
              options={[
                { value: "USD", label: "USD" },
                { value: "EUR", label: "EUR" },
                { value: "GBP", label: "GBP" },
                { value: "INR", label: "INR" },
                { value: "CAD", label: "CAD" },
              ]}
              onChange={(v) => updateField("salary_currency", v)}
            />
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-wf-border bg-wf-bg flex gap-2">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className="px-4 py-2 text-sm text-wf-text border border-wf-border rounded-[10px] hover:bg-wf-surfaceHover"
          >
            Back
          </button>
        )}
        <button type="button" onClick={handleSkip} className="px-4 py-2 text-sm text-wf-muted hover:text-wf-text">
          Skip
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={saving}
          className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-[10px] hover:bg-primary-600 disabled:opacity-50"
        >
          {saving ? "Saving…" : step < STEPS.length - 1 ? "Next" : "Save & continue"}
        </button>
      </div>

      {error && (
        <div className="px-4 pb-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable form components
// ---------------------------------------------------------------------------

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-wf-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-[10px] border border-wf-border bg-wf-surface px-3 py-2 text-sm text-wf-text placeholder:text-wf-dim focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30 outline-none"
      />
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-wf-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-[10px] border border-wf-border bg-wf-surface px-3 py-2 text-sm text-wf-text focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30 outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
