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
  const mapping = {
    full_name: ["name", "full name", "fullname", "applicant name"],
    email: ["email", "e-mail"],
    phone: ["phone", "mobile", "tel"],
    location: ["location", "city"],
    linkedin_url: ["linkedin"],
    github_url: ["github"],
    website_url: ["website", "portfolio", "url"],
    work_authorization: ["authorization", "work auth", "eligible"],
    address_line1: ["address", "street"],
    city: ["city"],
    state: ["state", "province"],
    zip_code: ["zip", "postal"],
    country: ["country"],
  };

  function labelFor(el) {
    const bits = [
      el.name,
      el.id,
      el.placeholder,
      el.getAttribute("aria-label"),
      el.autocomplete,
    ];
    const label = el.id && document.querySelector(`label[for="${el.id}"]`);
    if (label) bits.push(label.textContent);
    return bits.filter(Boolean).join(" ").toLowerCase();
  }

  const inputs = document.querySelectorAll("input, textarea");
  for (const [field, aliases] of Object.entries(mapping)) {
    const value = profile[field];
    if (value === null || value === undefined || value === "") continue;
    for (const el of inputs) {
      const hay = labelFor(el);
      if (aliases.some((alias) => hay.includes(alias))) {
        el.value = String(value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }
})();
