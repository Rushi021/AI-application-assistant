# Personal AI application assistant

A local FastAPI application and Chrome extension that discover jobs, score your selected resume, prepare tailored documents, and wait for your approval before an application is attempted. The original **paste JD → choose resume → edit lines → finalize** wizard remains available.

## Run

Python 3.11+ and Chrome are required. Start the backend and keep it running for background preparation:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Set GOOGLE_AI_API_KEY, or configure another provider:model in .env.
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open [the local app](http://localhost:8000/#/agent). Upload a DOCX or LaTeX source resume in Resume store, fill Personal information, then configure Agent queue. Select the resume, roles, locations, sources, score threshold, and scan interval. Enable background preparation and save. Jobs are gathered and prepared without keeping this page open; the backend must remain running.

Load `extension/` unpacked at `chrome://extensions`, with Developer mode enabled. Its API base/token must match the backend. Approved packets are picked up one at a time, about once a minute, or immediately with **Run next approved application**. Chrome opens the employer page so you can oversee it.

## Sources

Enter one per line in Agent settings:

```text
greenhouse:anthropic
lever:palantir
ashby:openai
remotive
```

These are examples of employer boards, not a complete internet index. Supply employers relevant to your search. Workday uses `workday:tenant.wdN.boardName` from that employer's careers URL. The Workday connector uses its public CXS endpoint and may be blocked by a tenant.

Add `google_jobs` and set `SERPAPI_API_KEY` on the backend for Google Jobs results, including available popular-portal listings. Availability and quota depend on that provider. The application prefers employer/ATS links when returned. No LinkedIn/Indeed password or session is collected. Remotive links go to its job pages, requiring employer-link navigation before applying.

## Documents and approval

The uploaded DOCX is the resume template. Only permitted text runs are edited; other package entries, styles, margins, headers, tab stops, and frozen sections are preserved. Automated preparation rejects proposed lines that grow beyond the original character budget or change alignment whitespace. The manual line editor remains available.

LaTeX edits splice into the original source, preserving surrounding commands and whitespace. Install `tectonic` or `pdflatex` to produce an attachable PDF. For DOCX-to-PDF preview, install LibreOffice; DOCX exports work without it.

Cover letters inherit the DOCX title/contact block, typography, and page setup. For an exact **letter** layout, upload a DOCX letter template containing `{{cover_letter}}` in the packet editor. Changing text can change wrapping even when all formatting is preserved; this is not a guarantee of pixel-identical pages for arbitrary replacement text. PDF/DOC uploads are not editable source templates—use their original DOCX/LaTeX sources for layout-preserving tailoring.

Download and review both documents. Approvals bind to their content, the selected resume, profile, job description, and application URL. Changes require approval again. The extension fills known fields, attaches documents, and attempts one final submission on supported Greenhouse, Lever, or Ashby forms. Unknown required questions, CAPTCHA, redirects, login, unsupported navigation, or ambiguous confirmation pause as **needs_attention**. It does not guess answers or retry uncertain submissions. Explicit manual resolution is available after checking the employer.

## Verification

```sh
cd backend && .venv/bin/pytest -q
cd ../extension && npm install
npx playwright install chromium
npm test
```

Tests use synthetic candidate data and mocked model/provider responses. Browser fixtures intercept ATS URLs; they do not submit to real employers. Read-only live connector checks are separate. Fake models (`LLM_DEFAULT=fake:fake`, `LLM_RESUME_TAILOR=fake:fake`, `EMBEDDING_DEFAULT=fake:fake`) are for offline development, not real application documents.

This remains a **single-user local tool**, with the existing development login `testuser` / `testpass` and configured bearer token. Do not expose it publicly with development authentication. Backend CORS admits the local app and extension origins. A persistent backend, configured model credentials, and installed extension are necessary; an inactive laptop cannot discover jobs by itself.

See [agent architecture and operation](docs/AUTONOMOUS_AGENT.md), [source architecture](ARCHITECTURE.md), and [extension setup](extension/README.md).
