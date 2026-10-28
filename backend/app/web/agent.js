/* DOM-based rendering: external job descriptions are never interpreted as HTML. */
(() => {
  const root = document.getElementById("agent-queue"), form = document.getElementById("agent-plan");
  const status = document.getElementById("agent-status");
  let initialized = false, refreshing = false;
  function element(tag, text, cls) { const el=document.createElement(tag); if(text!==undefined) el.textContent=text; if(cls) el.className=cls; return el; }
  function button(text, callback) { const b=element("button",text); b.type="button"; b.onclick=async()=>{b.disabled=true;try{await callback();}catch(err){banner(err.message,true);}finally{b.disabled=false;}};return b; }
  async function download(item,kind) {
    const file=await api(`/agent/queue/${item.id}/documents/${kind}`);
    const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));
    const url=URL.createObjectURL(new Blob([bytes],{type:file.type}));
    const a=document.createElement("a");a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }
  async function decision(item,action,resume_id) { await api(`/agent/queue/${item.id}/decision`,{method:"POST",body:{action,resume_id}}); await loadAgent(false); }
  async function editor(item,card) {
    const existing=card.querySelector(".packet-editor"); if(existing){existing.remove();return;}
    const run=await api(`/tailoring/runs/${item.run_id}`), sections=JSON.parse(run.sections_json);
    const box=element("div",undefined,"packet-editor");
    box.append(element("h4","Review resume lines and cover letter"));
    const edits=[];
    for(const section of sections){
      box.append(element("h4",section.name));
      for(const bullet of section.bullets||[]){
        const area=element("textarea");area.value=bullet.text;area.rows=2;area.disabled=!bullet.editable||!section.editable;
        area.setAttribute("aria-label",`${section.name} resume line`);box.append(area);edits.push({section,bullet,area});
      }
    }
    const cover=element("textarea");cover.value=run.cover_letter||"";cover.rows=10;cover.setAttribute("aria-label","Cover letter");box.append(element("h4","Cover letter"),cover);
    const template=element("input");template.type="file";template.accept=".docx";
    const label=element("label","Optional exact-layout letter template (DOCX with {{cover_letter}})");label.append(template);box.append(label);
    box.append(element("p","Resume edits keep the uploaded document's formatting. Letter bodies use its typography and title block; upload a letter template when its exact layout matters.","hint"));
    box.append(button("Save edits and finalize again",async()=>{
      for(const section of sections){
        const changes=edits.filter(e=>e.section.id===section.id&&e.bullet.editable&&e.area.value!==e.bullet.text);
        if(changes.length) await api(`/tailoring/runs/${run.id}/sections/${section.id}`,{method:"PATCH",body:{bullets:changes.map(e=>({id:e.bullet.id,text:e.area.value}))}});
      }
      if(cover.value!==run.cover_letter) await api(`/tailoring/runs/${run.id}/cover-letter`,{method:"PATCH",body:{text:cover.value}});
      if(template.files.length){const data=new FormData();data.append("file",template.files[0]);await api(`/tailoring/runs/${run.id}/cover-template`,{method:"POST",body:data,isForm:true});}
      await api(`/tailoring/runs/${run.id}/finalize`,{method:"POST"});
      await loadAgent(false);banner("Documents updated. Download and review before approving.");
    }));card.append(box);
  }
  async function loadAgent(configure=true){
    if(refreshing)return;refreshing=true;
    try {
      const [plan,items,resumes]=await Promise.all([api("/agent/plan"),api("/agent/queue"),api("/resumes")]);
      const select=document.getElementById("agent-resume");
      if(!initialized||configure&&!form.contains(document.activeElement)){
        select.replaceChildren(...resumes.filter(r=>["docx","tex"].includes(r.source_format)).map(r=>{const o=element("option",`${r.original_filename} · ${r.family} v${r.version}`);o.value=r.id;return o;}));
        if(plan.config){for(const [key,value]of Object.entries(plan.config)){
          const input=form.elements.namedItem(key);if(!input)continue;
          if(key==="sources")input.value=value.map(s=>s.provider+(s.board?`:${s.board}`:"")).join("\n");
          else if(key==="enabled")input.checked=value;
          else input.value=key==="minimum_score"?value*100:Array.isArray(value)?value.join(", "):value;
        }} initialized=true;
      }
      status.textContent=[plan.running?"Preparing packets…":plan.config?.enabled?"Background preparation enabled":"Background preparation paused",plan.last_run?`Last scan: ${new Date(plan.last_run+"Z").toLocaleString()}`:"",plan.error||""].filter(Boolean).join(" · ");
      root.replaceChildren();
      if(!items.length)root.append(element("p","No packets yet. Upload a resume, save your sources, and run discovery.","empty"));
      for(const item of items){
        const card=element("article",undefined,"card");card.append(element("h3",`${item.company||"Company"} — ${item.role||"Role"}`));
        card.append(element("p",`${item.state} · ${item.score===null?"not scored":Math.round(item.score*100)+"% match"} · ${item.source} · ${item.location}`,"meta"));
        if(item.error||item.warning)card.append(element("p",[item.error,item.warning].filter(Boolean).join(" · "),"hint"));
        const details=element("details");details.append(element("summary","Job description and score evidence"),element("p",item.description),element("pre",JSON.stringify(item.evidence,null,2)));card.append(details);
        const actions=element("div",undefined,"row-actions");
        if(item.url?.startsWith("https://")){const link=element("a","Open posting");link.href=item.url;link.target="_blank";link.rel="noreferrer";actions.append(link);}
        if(item.run_id){actions.append(button("Review / edit packet",()=>editor(item,card)),button("Download resume",()=>download(item,"resume")),button("Download cover letter",()=>download(item,"cover_letter")));}
        if(item.state==="needs_attention") {
          for (const [text,outcome] of [["I confirmed employer received it","submitted"],["I verified it was not submitted","not_submitted"]])
            actions.append(button(text,async()=>{await api(`/agent/queue/${item.id}/resolve`,{method:"POST",body:{outcome}});await loadAgent(false);}));
        }
        if(item.state==="ready") actions.append(button("Approve application",()=>decision(item,"approve")));
        if(!["submitted","filling"].includes(item.state))actions.append(button("Reject",()=>decision(item,"reject")));
        if(!["submitted","filling","needs_attention"].includes(item.state)){
          const pick=element("select");pick.setAttribute("aria-label","Resume for this job");
          for(const r of resumes.filter(r=>["docx","tex"].includes(r.source_format))){const option=element("option",r.original_filename);option.value=r.id;option.selected=r.id===item.resume_id;pick.append(option);}
          actions.append(pick,button("Prepare with selected resume",()=>decision(item,"reprepare",Number(pick.value))));
        }
        card.append(actions);root.append(card);
      }
    }catch(err){status.textContent=err.message;}finally{refreshing=false;}
  }
  form.onsubmit=async event=>{
    event.preventDefault();const values=new FormData(form);const split=key=>String(values.get(key)||"").split(",").map(x=>x.trim()).filter(Boolean);
    try{await api("/agent/plan",{method:"PUT",body:{enabled:form.elements.enabled.checked,resume_id:Number(values.get("resume_id")),roles:split("roles"),locations:split("locations"),minimum_score:Number(values.get("minimum_score"))/100,interval_minutes:Number(values.get("interval_minutes")),max_prepare:Number(values.get("max_prepare")),instructions:values.get("instructions"),sources:String(values.get("sources")).split("\n").filter(x=>x.trim()).map(line=>{const [provider,board=""]=line.trim().split(":");return {provider,board};})}});banner("Agent plan saved.");await loadAgent(false);}catch(err){banner(err.message,true);}
  };
  document.getElementById("agent-scan").onclick=async()=>{try{await api("/agent/scan",{method:"POST"});await loadAgent(false);}catch(err){banner(err.message,true);}};
  document.getElementById("agent-refresh").onclick=()=>loadAgent(false);
  window.loadAgent=loadAgent;
  // Do not destroy text edits during background refresh.
  setInterval(()=>{if(state.token&&location.hash==="#/agent"&&!root.querySelector(".packet-editor")&&!form.contains(document.activeElement))loadAgent(false);},15000);
})();
