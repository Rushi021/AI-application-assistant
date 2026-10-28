/* MV3 execution broker. The backend, not extension storage, owns queue state. */
importScripts("api.js");
let draining = false;
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await chrome.storage.local.get(["apiBase", "token"]);
  await chrome.storage.local.set({apiBase:settings.apiBase || "http://localhost:8000", token:settings.token || "test-token"});
  chrome.alarms.create("application-queue", {periodInMinutes:1});
});
chrome.runtime.onStartup.addListener(() => chrome.alarms.create("application-queue", {periodInMinutes:1}));
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "application-queue") drain().catch(console.error); });

async function waitLoaded(tabId) {
  for (let i=0;i<60;i++) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return tab;
    await new Promise(r => setTimeout(r,500));
  }
  throw new Error("Application page did not load in 30 seconds");
}
async function documents(packet) {
  const files = {};
  for (const kind of packet.documents) files[kind] = await api(`/agent/queue/${packet.id}/documents/${kind}?lease_token=${encodeURIComponent(packet.lease_token)}`);
  return files;
}
async function drain() {
  if (draining) return {running:true};
  draining = true;
  let packet;
  try {
    // One application per alarm/user action keeps the browser observable and bounded.
    packet = await api("/agent/claim", {method:"POST", body:{}});
    if (!packet) return {empty:true};
    const destination = new URL(packet.url);
    if (destination.protocol !== "https:") throw new Error("Invalid application destination");
    const files = await documents(packet);
    const tab = await chrome.tabs.create({url:packet.url, active:true});
    await chrome.storage.local.set({activeApplication:{id:packet.id, tabId:tab.id, startedAt:Date.now()}});
    await waitLoaded(tab.id);
    await chrome.scripting.executeScript({target:{tabId:tab.id}, files:["src/content/engine.js"]});
    const outputs = await chrome.scripting.executeScript({
      target:{tabId:tab.id}, func:async data => {
        AssistantAutofill.status("Approved application: filling fields and checking required answers…");
        const result = await AssistantAutofill.apply(data, async () => {
          const checked = await chrome.runtime.sendMessage({type:"VALIDATE_SUBMISSION", id:data.id, lease_token:data.lease_token});
          return checked?.valid === true;
        });
        AssistantAutofill.status(`${result.state}\n${result.detail}`);
        return result;
      }, args:[{...packet, files}],
    });
    const result = outputs[0]?.result;
    if (!result) throw new Error("Page navigation interrupted execution. Check the employer confirmation.");
    await api(`/agent/queue/${packet.id}/result`, {method:"POST", body:{...result, lease_token:packet.lease_token}});
    return result;
  } catch (err) {
    if (packet) await api(`/agent/queue/${packet.id}/result`, {method:"POST", body:{state:"needs_attention", detail:String(err.message || err), url:packet.url, lease_token:packet.lease_token}}).catch(console.error);
    throw err;
  } finally { draining=false; await chrome.storage.local.remove("activeApplication"); }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === "VALIDATE_SUBMISSION" && sender.tab) {
    (async () => {
      const {activeApplication} = await chrome.storage.local.get("activeApplication");
      if (activeApplication?.tabId !== sender.tab.id || activeApplication?.id !== message.id) return {valid:false};
      return api(`/agent/queue/${message.id}/validate`,{method:"POST",body:{lease_token:message.lease_token}});
    })().then(respond,()=>respond({valid:false}));
    return true;
  }
  // Other commands are accepted only from extension pages, not visited websites.
  if (sender.tab) return false;
  if (message?.type === "DRAIN_APPROVED") { drain().then(respond, err=>respond({error:err.message})); return true; }
  if (message?.type === "FILL_CURRENT") {
    (async () => {
      const profile = await api("/applications/autofill-payload");
      const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
      if (!tab?.id) throw new Error("No active tab");
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:["src/content/engine.js"]});
      const output = await chrome.scripting.executeScript({target:{tabId:tab.id},func:async p => {
        const result = await AssistantAutofill.fill({profile:p});
        AssistantAutofill.status(`Filled ${result.filled.length} fields. Review and submit manually.\nMissing: ${result.missing.join(", ")}`);
        return result;
      },args:[profile]});
      return output[0]?.result;
    })().then(respond, err=>respond({error:err.message})); return true;
  }
  return false;
});
