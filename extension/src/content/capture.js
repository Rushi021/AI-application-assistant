(() => {
  const selectors = ['[itemprop="description"]', '[data-testid="job-description"]', '.job-description', '#job_description', '.posting-page', 'main'];
  const element = selectors.map(s=>document.querySelector(s)).find(e=>e?.innerText?.trim().length>100);
  return {raw_text:(element?.innerText || document.body.innerText).slice(0,80000), role:document.querySelector('h1')?.innerText || document.title, application_link:location.href, source:"captured"};
})();
