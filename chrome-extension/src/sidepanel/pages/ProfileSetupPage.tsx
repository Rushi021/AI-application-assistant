import { useState } from "react";
import { useAppStore } from "../store";
import { updateProfile } from "../services/api";
import { STORAGE_KEYS } from "@/shared/constants";
import type { UserProfile } from "@/shared/types";

const STEPS = ["Basic Info", "Professional", "Education", "Work Auth", "Demographics", "Salary"];

export default function ProfileSetupPage() {
  const { profile, setProfile, setPage } = useAppStore();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    degree: profile?.degree ?? "",
    field_of_study: profile?.field_of_study ?? "",
    university: profile?.university ?? "",
    graduation_year: profile?.graduation_year ?? null,
    gpa: profile?.gpa ?? null,
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

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProfile(form);
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
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-lg font-bold text-gray-900">Complete Your Profile</h1>
        <p className="text-xs text-gray-500 mt-1">
          This info will be used to auto-fill job applications.
        </p>
        {/* Step indicator */}
        <div className="flex gap-1 mt-3">
          {STEPS.map((s, i) => (
            <button
              key={s}
              onClick={() => setStep(i)}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                i <= step ? "bg-primary-500" : "bg-gray-200"
              }`}
            />
          ))}
        </div>
        <p className="text-xs font-medium text-primary-600 mt-2">{STEPS[step]}</p>
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
          </>
        )}
        {step === 2 && (
          <>
            <Input label="Degree" value={form.degree ?? ""} onChange={(v) => updateField("degree", v)} placeholder="e.g. Master of Science" />
            <Input label="Field of Study" value={form.field_of_study ?? ""} onChange={(v) => updateField("field_of_study", v)} placeholder="e.g. Computer Science" />
            <Input label="University" value={form.university ?? ""} onChange={(v) => updateField("university", v)} />
            <Input label="Graduation Year" value={String(form.graduation_year ?? "")} onChange={(v) => updateField("graduation_year", v ? parseInt(v) : null)} type="number" />
            <Input label="GPA" value={String(form.gpa ?? "")} onChange={(v) => updateField("gpa", v ? parseFloat(v) : null)} />
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
      <div className="px-4 py-3 border-t bg-white flex gap-2">
        {step > 0 && (
          <button onClick={() => setStep(step - 1)} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">
            Back
          </button>
        )}
        <button onClick={handleSkip} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
          Skip
        </button>
        <button
          onClick={handleNext}
          disabled={saving}
          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : step < STEPS.length - 1 ? "Next" : "Save & Continue"}
        </button>
      </div>

      {error && (
        <div className="px-4 pb-2">
          <p className="text-xs text-red-600">{error}</p>
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
      <span className="text-xs font-medium text-gray-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
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
      <span className="text-xs font-medium text-gray-700">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none bg-white"
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
