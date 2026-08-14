chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["apiBase", "token"], (stored) => {
    const patch = {};
    if (!stored.apiBase) patch.apiBase = "http://localhost:8000";
    if (!stored.token) patch.token = "test-token";
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({ ok: true });
  }
  return false;
});
