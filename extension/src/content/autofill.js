(async function autofill() {
  const stored = await chrome.storage.local.get(["apiBase", "token"]);
  const apiBase = stored.apiBase || "http://localhost:8000";
  const token = stored.token || "test-token";
  const res = await fetch(`${apiBase}/applications/autofill-payload`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.warn("autofill: profile fetch failed", res.status);
    return;
  }
  const profile = await res.json();

  const BOOL_FIELDS = new Set([
    "willing_to_relocate",
    "legally_authorized_to_work",
    "needs_sponsorship",
    "at_least_18",
    "has_non_compete",
  ]);

  const mapping = [
    { field: "full_name", aliases: ["name", "full name", "fullname", "applicant name", "legal name"] },
    { field: "email", aliases: ["email", "e-mail"] },
    { field: "phone", aliases: ["phone", "mobile", "tel"] },
    { field: "location", aliases: ["location"] },
    { field: "linkedin_url", aliases: ["linkedin"] },
    { field: "github_url", aliases: ["github"] },
    { field: "website_url", aliases: ["website", "portfolio"] },
    { field: "address_line1", aliases: ["address", "street"] },
    { field: "city", aliases: ["city"] },
    { field: "state", aliases: ["state", "province"] },
    { field: "zip_code", aliases: ["zip", "postal"] },
    { field: "country", aliases: ["country"] },
    { field: "desired_salary_base", aliases: ["desired salary", "expected salary", "base salary", "compensation", "salary"] },
    { field: "desired_salary_min", aliases: ["salary min", "minimum salary"] },
    { field: "desired_salary_max", aliases: ["salary max", "maximum salary"] },
    { field: "gender", aliases: ["gender", "sex"] },
    { field: "race_ethnicity", aliases: ["race", "ethnicity", "ethnic"] },
    { field: "veteran_status", aliases: ["veteran"] },
    { field: "disability_status", aliases: ["disability", "disabled"] },
    { field: "willing_to_relocate", aliases: ["relocate", "relocation"] },
    { field: "highest_degree", aliases: ["highest degree", "degree", "education level"] },
    { field: "school_name", aliases: ["university", "college", "school"] },
    { field: "field_of_study", aliases: ["major", "field of study", "area of study"] },
    { field: "graduation_date", aliases: ["graduation", "grad date", "expected graduation"] },
    { field: "gpa", aliases: ["gpa", "grade point"] },
    { field: "legally_authorized_to_work", aliases: ["authorized to work", "legally authorized", "work authorization", "eligible to work"] },
    { field: "needs_sponsorship", aliases: ["sponsorship", "visa", "require sponsorship"] },
    { field: "citizenship_country", aliases: ["citizenship", "citizen of"] },
    { field: "at_least_18", aliases: ["18 years", "at least 18", "over 18"] },
    { field: "has_non_compete", aliases: ["non-compete", "noncompete", "restrictive covenant"] },
  ];

  function yesNo(value) {
    if (value === true) return "Yes";
    if (value === false) return "No";
    return String(value);
  }

  function asText(field, value) {
    return BOOL_FIELDS.has(field) ? yesNo(value) : String(value);
  }

  function labelFor(el) {
    const bits = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.autocomplete];
    const label = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) bits.push(label.textContent);
    const wrapping = el.closest("label");
    if (wrapping) bits.push(wrapping.textContent);
    return bits.filter(Boolean).join(" ").toLowerCase();
  }

  function fill(el, field, value) {
    const text = asText(field, value);
    const lower = text.toLowerCase();
    if (el.type === "checkbox") {
      el.checked = value === true || lower === "yes";
    } else if (el.type === "radio") {
      const hay = `${labelFor(el)} ${el.value}`.toLowerCase();
      el.checked = hay.includes(lower) || el.value.toLowerCase() === String(value).toLowerCase();
    } else if (el.tagName === "SELECT") {
      const match = [...el.options].find(
        (opt) => opt.value.toLowerCase() === lower || opt.text.toLowerCase().includes(lower)
      );
      if (match) el.value = match.value;
    } else {
      el.value = text;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const controls = document.querySelectorAll("input, textarea, select");
  for (const { field, aliases } of mapping) {
    const value = profile[field];
    if (value === null || value === undefined || value === "") continue;
    for (const el of controls) {
      if (aliases.some((alias) => labelFor(el).includes(alias))) {
        fill(el, field, value);
      }
    }
  }
})();
