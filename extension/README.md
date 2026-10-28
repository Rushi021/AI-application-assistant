# Chrome extension

Vanilla Manifest V3. No build step.

1. Start the backend (`uvicorn app.main:app --reload` from `backend/`).
2. Chrome → `chrome://extensions` → Developer mode → Load unpacked → select this `extension/` folder.
3. Open Options to confirm API base (`http://localhost:8000`) and token (`test-token`).
4. Upload at least one `.tex` base resume via `POST /resumes/upload`, then use the popup.

The popup is a 5-step wizard. **Step 1 is always manual JD paste, and nothing else** — company, role, sponsorship, date posted, and apply link are asked for at the top of step 5. Fill them before saving to the resume library: the company name goes into the saved filename and onto the tracker row.

Step 2 scores the JD against your base resumes and holds the resume store, so you can upload and delete resumes without leaving the popup. This is the same store as the website: uploads and deletes on either side show up on the other. Automated page capture (`src/content/capture.js`) is a placeholder.

The popup uses a light, mint-accented interface with five progress steps and a
persistent action bar. Resume match cards show overall alignment and requirement
coverage. In the review step, text fields expand to fit each line; protected
sections are collapsed and labeled. Edits save on blur, and refinement/finalization
wait for pending edits. Busy actions show progress and disable duplicate clicks.

After changing extension files, click **Reload** for this extension at
`chrome://extensions`, then close and reopen its popup.
