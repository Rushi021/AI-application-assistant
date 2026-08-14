# Chrome extension

Vanilla Manifest V3. No build step.

1. Start the backend (`uvicorn app.main:app --reload` from `backend/`).
2. Chrome → `chrome://extensions` → Developer mode → Load unpacked → select this `extension/` folder.
3. Open Options to confirm API base (`http://localhost:8000`) and token (`test-token`).
4. Upload at least one `.tex` base resume via `POST /resumes/upload`, then use the popup.

The popup is a 5-step wizard. **Step 1 is always manual JD paste.** Automated page capture (`src/content/capture.js`) is a placeholder.
