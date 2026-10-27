/* Shared, testable ATS engine. No credentials or backend tokens enter page scope. */
(() => {
  if (globalThis.AssistantAutofill) return;
  const norm = value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const rules = [
    ["first_name", /\b(first name|given name|given-name|firstname)\b/],
    ["middle_name", /\b(middle name|middle initial|additional name)\b/],
    ["last_name", /\b(last name|family name|surname|lastname)\b/],
    ["full_name", /\b(full name|legal name|applicant name)\b/],
    ["email", /\b(e mail|email)\b/], ["phone", /\b(phone|mobile|telephone|tel)\b/],
    ["linkedin_url", /\blinkedin\b/], ["github_url", /\bgithub\b/],
    ["website_url", /\b(website|portfolio|personal site)\b/],
    ["address_line1", /\b(street address|address line 1|address line1)\b/],
    ["city", /\b(city|address level2)\b/], ["state", /\b(state|province|address level1)\b/],
    ["zip_code", /\b(zip|postal code)\b/], ["country", /\bcountry\b/],
    ["location", /\b(current location|location)\b/],
    ["legally_authorized_to_work", /\b(authorized to work|authorised to work|legally authorized|eligible to work|work authorization)\b/],
    ["needs_sponsorship", /\b(sponsorship|require a visa|visa sponsorship)\b/],
    ["willing_to_relocate", /\b(relocate|relocation)\b/],
    ["desired_salary_base", /\b(desired salary|expected salary|salary expectation)\b/],
    ["school_name", /\b(university|college|school name)\b/],
    ["highest_degree", /\b(degree|education level)\b/], ["field_of_study", /\b(major|field of study)\b/],
    ["graduation_date", /\b(graduation date|graduated)\b/], ["gpa", /\bgpa\b/],
    ["gender", /\b(gender|sex)\b/], ["race_ethnicity", /\b(race|ethnicity)\b/],
    ["veteran_status", /\bveteran\b/], ["disability_status", /\bdisability\b/],
    ["at_least_18", /\b(at least 18|18 years)\b/], ["has_non_compete", /\bnon compete\b/],
    ["cover_letter", /\bcover letter\b/],
  ];
  const autocomplete = {"given-name":"first_name", "additional-name":"middle_name", "family-name":"last_name", name:"full_name", email:"email", tel:"phone", "address-line1":"address_line1", "address-level2":"city", "address-level1":"state", "postal-code":"zip_code", "country-name":"country"};
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
  function label(el) {
    const labels = [...(el.labels || [])].map(x => x.textContent);
    const aria = (el.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => document.getElementById(id)?.textContent);
    const group = el.closest("fieldset")?.querySelector("legend")?.textContent;
    return [...labels, ...aria, el.getAttribute("aria-label"), group, el.placeholder, el.name, el.id].filter(Boolean).join(" ").slice(0, 2000);
  }
  function keyFor(el, profile = {}) {
    if (autocomplete[el.autocomplete]) return autocomplete[el.autocomplete];
    const text = norm(label(el));
    const custom = Object.keys(profile.custom_answers || {}).find(k => norm(k) === text);
    if (custom) return `custom:${custom}`;
    const hits = rules.filter(([,pattern]) => pattern.test(text));
    // Prefer the specific name/authorization field, never multiple writes per control.
    if (hits.some(([k]) => k === "needs_sponsorship")) return "needs_sponsorship";
    if (hits.length > 1) {
      const specific = hits.filter(([k]) => !["location", "country", "full_name"].includes(k));
      return specific.length === 1 ? specific[0][0] : null;
    }
    return hits[0]?.[0] || null;
  }
  const textValue = value => typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  function setNative(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", {bubbles:true}));
    el.dispatchEvent(new Event("change", {bubbles:true}));
    el.dispatchEvent(new FocusEvent("blur", {bubbles:true}));
  }
  function adapter() {
    const host = location.hostname;
    if (/(^|\.)greenhouse\.io$/.test(host)) return "greenhouse";
    if (/(^|\.)lever\.co$/.test(host)) return "lever";
    if (/(^|\.)ashbyhq\.com$/.test(host)) return "ashby";
    if (/myworkdayjobs\.com$|myworkdaysite\.com$/.test(host)) return "workday";
    return "generic";
  }
  function controlRoots() {
    const roots = [document];
    for (let i = 0; i < roots.length && i < 200; i++)
      for (const el of roots[i].querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
    return roots;
  }
  function controls() { return controlRoots().flatMap(r => [...r.querySelectorAll("input,textarea,select")]).slice(0, 500); }
  function requiredMissing() {
    return controls().filter(el => !el.disabled && (visible(el) || el.type === "file") &&
      (el.required || el.getAttribute("aria-required") === "true") &&
      (el.type === "file" ? !el.files?.length : el.type === "checkbox" ? !el.checked : el.type === "radio" ? !controls().some(x => x.name === el.name && x.checked) : !String(el.value || "").trim() || !el.checkValidity()))
      .map(el => label(el) || el.type);
  }
  function hasCaptcha() {
    return [...document.querySelectorAll('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],.g-recaptcha,.h-captcha,[data-sitekey]')].some(visible);
  }
  function success() {
    return /thank you for (applying|your application)|application (has been |was )?(successfully submitted|received)|we have received your application/i.test(document.body.innerText);
  }
  async function fill(packet) {
    const profile = {...packet.profile, cover_letter:packet.cover_letter};
    if (!profile.full_name) profile.full_name = [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(" ");
    try { profile.custom_answers = JSON.parse(profile.custom_fields_json || "{}"); } catch { profile.custom_answers = {}; }
    const filled = new Set(), skipped = new Set();
    for (let round = 0; round < 3; round++) {
      for (const el of controls()) {
        if (el.disabled || el.readOnly || (el.type !== "file" && !visible(el)) || ["hidden", "password", "submit", "button", "reset"].includes(el.type)) continue;
        if (el.type === "file") {
          if (el.files?.length) continue;
          const kind = /cover/i.test(label(el)) ? "cover_letter" : /resume|\bcv\b/i.test(label(el)) ? "resume" : null;
          const accepts = doc => {
            const allowed = (el.accept || "").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
            return doc && (!allowed.length || allowed.some(a=>a===doc.type || a.startsWith(".")&&doc.name.toLowerCase().endsWith(a) || a.endsWith("/*")&&doc.type.startsWith(a.slice(0,-1))));
          };
          const primary = packet.files?.[kind];
          const doc = accepts(primary) ? primary : packet.files?.[`${kind}_pdf`] || primary;
          if (!doc) { skipped.add(label(el)); continue; }
          const bytes = Uint8Array.from(atob(doc.base64), c => c.charCodeAt(0));
          const file = new File([bytes], doc.name, {type:doc.type});
          const accept = (el.accept || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
          if (accept.length && !accept.some(a => a === doc.type || a.startsWith(".") && doc.name.toLowerCase().endsWith(a) || a.endsWith("/*") && doc.type.startsWith(a.slice(0,-1)))) { skipped.add(`File type: ${label(el)}`); continue; }
          const transfer = new DataTransfer(); transfer.items.add(file); el.files = transfer.files;
          el.dispatchEvent(new Event("change", {bubbles:true})); filled.add(label(el)); continue;
        }
        const key = keyFor(el, profile);
        const value = key?.startsWith("custom:") ? profile.custom_answers[key.slice(7)] : profile[key];
        if (!key || value === null || value === undefined || value === "") { skipped.add(label(el)); continue; }
        const target = textValue(value);
        if (el.type === "radio") {
          const option = norm(el.value) === norm(target) || [...(el.labels || [])].some(l => norm(l.textContent) === norm(target));
          if (option && !el.checked) { el.click(); filled.add(label(el)); }
        } else if (el.type === "checkbox") {
          // Never tick broad consents or certifications from an unrelated alias.
          if (typeof value === "boolean" && el.checked !== value) { el.click(); filled.add(label(el)); }
        } else if (el.tagName === "SELECT") {
          const options = [...el.options].filter(o => norm(o.value) === norm(target) || norm(o.textContent) === norm(target));
          if (options.length === 1) { setNative(el, options[0].value); filled.add(label(el)); }
          else skipped.add(label(el));
        } else if (!el.value) {
          setNative(el, target);
          if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") === "list") {
            await sleep(400);
            const matches = [...document.querySelectorAll('[role="option"]')].filter(x => visible(x) && norm(x.textContent) === norm(target));
            if (matches.length === 1) matches[0].click(); else { setNative(el, ""); skipped.add(label(el)); continue; }
          }
          if (el.value === target) filled.add(label(el)); else skipped.add(label(el));
        }
      }
      await sleep(350);
    }
    const blocked = [...new Set(requiredMissing())];
    const report = {adapter:adapter(), filled:[...filled], skipped:[...skipped], missing:blocked, captcha:hasCaptcha(), url:location.href};
    return report;
  }
  async function apply(packet, beforeSubmit = null) {
    if (new URL(packet.url).origin !== location.origin) return {state:"needs_attention", detail:"Application redirected to a different origin. Review its destination.", url:location.href};
    if (/no longer accepting applications|this (job|position) (is|has been) (closed|filled)|job (is )?no longer available/i.test(document.body.innerText))
      return {state:"needs_attention",detail:"This posting appears closed. No submission was attempted.",url:location.href};
    for (let i=0;i<20&&!controls().some(el=>visible(el)||el.type==="file");i++) await sleep(500);
    if (success()) return {state:"needs_attention",detail:"This page already contains an application confirmation. Check whether you already applied.",url:location.href};
    const report = await fill(packet);
    if (report.captcha || report.missing.length) return {state:"needs_attention", detail:JSON.stringify(report), url:location.href};
    if (!["greenhouse", "lever", "ashby"].includes(report.adapter)) return {state:"needs_attention", detail:"Form filled. This ATS needs manual review/navigation; final submission was not attempted.", url:location.href};
    const buttons = [...document.querySelectorAll('form button, form input[type="submit"]')].filter(el => visible(el) && !el.disabled && /^(submit|submit application|send application|apply now)$/i.test((el.innerText || el.value || "").trim()));
    if (buttons.length !== 1 || !report.filled.length) return {state:"needs_attention", detail:"Could not identify exactly one final submit control or no fields were filled.", url:location.href};
    const form = buttons[0].closest("form");
    if (form && !form.reportValidity()) return {state:"needs_attention", detail:"Employer validation requires attention.", url:location.href};
    if (beforeSubmit && !(await beforeSubmit())) return {state:"needs_attention",detail:"The approved packet or execution lease changed. No submission was attempted.",url:location.href};
    // Submission is a one-shot action. Never retry after an ambiguous timeout.
    buttons[0].click();
    for (let i=0;i<40;i++) { await sleep(500); if (success()) return {state:"submitted", detail:"Employer confirmation detected.", url:location.href}; }
    return {state:"needs_attention", detail:"Submit clicked but confirmation was not observed. Check the employer before retrying.", url:location.href};
  }
  function status(text) {
    let host = document.getElementById("assistant-progress");
    if (!host) { host = document.createElement("div"); host.id="assistant-progress"; host.style="position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:420px"; document.documentElement.append(host); host.attachShadow({mode:"open"}); }
    host.shadowRoot.textContent = "";
    const panel = document.createElement("div"); panel.style="padding:16px;background:#122129;color:white;font:14px system-ui;white-space:pre-wrap;border-radius:12px"; panel.textContent=text; host.shadowRoot.append(panel);
  }
  globalThis.AssistantAutofill = {norm, keyFor, label, fill, apply, status, adapter, requiredMissing};
})();
