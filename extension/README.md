# Chrome extension

Manifest V3, vanilla JavaScript, no runtime build step.

1. Start the backend and open `http://localhost:8000/#/agent`.
2. Load this directory unpacked at `chrome://extensions`.
3. In Options, set API base/token to match the backend. The development defaults are `http://localhost:8000` and `test-token`.
4. Configure sources, profile and a source resume in the web app. Review packets before approving.
5. The extension checks approved jobs about once per minute. Use **Run next approved application** to start immediately. It opens an observable employer tab and processes one approved item per tick.

The popup retains the manual five-step JD/resume/edit/finalize wizard. Capture this job page can prefill its JD text. Finalized manual packets can be sent to the review queue; manual Autofill fills saved profile fields without submitting.

The background worker owns API access. The engine maps field evidence to saved profile values, uses native setter/events, attaches the packet's documents, and reports unresolved required fields. It does not guess unknown answers. Greenhouse, Lever, and Ashby final submission is attempted only with an approved packet and exactly one recognized final submit control. Other forms pause for manual review. CAPTCHA/login/custom multi-step forms and cross-origin embedded forms can require intervention.

HTTPS host permission is needed to open and inject into an approved employer page while the popup is closed. There are no always-on content scripts over all browsing pages. Backend credentials are not injected into visited page JavaScript.

For tests:

```sh
npm install
npx playwright install chromium
npm test
```

Set `CHROME_EXECUTABLE` to an existing Chromium-family executable to avoid downloading a browser. Tests intercept all fixture ATS URLs and never contact employers.

The popup uses a 760 × 600 light, mint-accented interface with five progress
steps and a persistent action bar. Its explicit root size avoids Chrome shrinking
the content during popup autosizing. The JD paste field appears before the optional
application-queue controls and is fully visible without scrolling. Resume match cards show overall alignment and requirement
coverage. In the review step, text fields expand to fit each line; protected
sections are collapsed and labeled. Edits save on blur, and refinement/finalization
wait for pending edits. Busy actions show progress and disable duplicate clicks.

After changing extension files, click **Reload** for this extension at
`chrome://extensions`, then close and reopen its popup.
