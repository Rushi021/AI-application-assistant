const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const path = require('node:path');
let browser;
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});});
after(async()=>{await browser?.close();});
const engine=path.join(__dirname,'../src/content/engine.js');
async function pageFor(body){
  const page=await browser.newPage();
  await page.route('https://boards.greenhouse.io/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body>${body}</body></html>`}));
  await page.goto('https://boards.greenhouse.io/example/jobs/123');
  await page.addScriptTag({path:engine});return page;
}
const packet={url:'https://boards.greenhouse.io/example/jobs/123',profile:{first_name:'Ada',last_name:'Lovelace',full_name:'Ada Lovelace',email:'ada@example.test',needs_sponsorship:false,country:'United States'},cover_letter:'Dear Hiring Manager, truthful cover letter.',files:{resume:{name:'resume.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',base64:Buffer.from('docx-fixture').toString('base64')}}};

test('approved packet fills exact fields, native select, boolean radios, and resume upload before confirmation',async()=>{
 const page=await pageFor(`<form id="application"><label>First name<input name="first_name" required></label><label>Last name<input name="last_name" required></label><label>Email<input type="email" name="email" required></label><label>Country<select name="country" required><option value="">Choose</option><option value="us">United States</option></select></label><fieldset><legend>Will you require sponsorship?</legend><label>Yes<input name="visa" type="radio" value="yes" required></label><label>No<input name="visa" type="radio" value="no" required></label></fieldset><label>Resume<input type="file" accept=".docx,.pdf" required></label><label>Cover letter<textarea></textarea></label><button type="submit">Submit Application</button></form><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();document.body.append('Thank you for applying');};</script>`);
 const report=await page.evaluate(p=>AssistantAutofill.apply(p),packet);
 assert.equal(report.state,'submitted',report.detail);
 assert.equal(await page.locator('[name="first_name"]').inputValue(),'Ada');
 assert.equal(await page.locator('[name="last_name"]').inputValue(),'Lovelace');
 assert.equal(await page.locator('select').inputValue(),'us');
 assert.equal(await page.locator('[value="no"]').isChecked(),true);
 assert.equal(await page.locator('[value="yes"]').isChecked(),false);
 assert.equal(await page.locator('[type="file"]').evaluate(el=>el.files[0].name),'resume.docx');
 await page.close();
});

test('unknown required questions block submission and are reported',async()=>{
 const page=await pageFor(`<form><label>First name<input required></label><label>Employee referral code<input required></label><button>Submit</button></form>`);
 await page.evaluate(()=>window.submitCount=0);
 await page.locator('form').evaluate(form=>form.onsubmit=e=>{e.preventDefault();window.submitCount++;});
 const result=await page.evaluate(p=>AssistantAutofill.apply(p),packet);
 assert.equal(result.state,'needs_attention');assert.match(result.detail,/Employee referral code/);assert.equal(await page.evaluate(()=>window.submitCount),0);await page.close();
});

test('file mismatch and visible CAPTCHA require manual attention',async()=>{
 const page=await pageFor(`<form><label>Email<input required></label><label>Resume<input type="file" accept=".pdf" required></label><div class="g-recaptcha" style="height:50px">Challenge</div><button>Submit</button></form>`);
 const result=await page.evaluate(p=>AssistantAutofill.apply(p),packet);
 assert.equal(result.state,'needs_attention');assert.match(result.detail,/File type|Resume/);assert.match(result.detail,/"captcha":true/);await page.close();
});

test('preserves existing user text and handles open shadow-root controls',async()=>{
 const page=await pageFor(`<label>First name<input value="User correction"></label><div id="shadow"></div>`);
 await page.evaluate(()=>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<label>Last name<input required></label>');
 const result=await page.evaluate(p=>AssistantAutofill.fill(p),packet);
 assert.equal(await page.locator('input').first().inputValue(),'User correction');
 assert.equal(await page.locator('#shadow input').inputValue(),'Lovelace');assert.equal(result.missing.length,0);await page.close();
});

test('cannot run approved packet on a redirected origin',async()=>{
 const page=await pageFor(`<form><label>Email<input></label><button>Submit</button></form>`);
 const result=await page.evaluate(p=>AssistantAutofill.apply({...p,url:'https://jobs.lever.co/other'}),packet);
 assert.equal(result.state,'needs_attention');assert.equal(await page.locator('input').inputValue(),'');await page.close();
});

test('a revoked approval stops at the pre-submit check',async()=>{
 const page=await pageFor(`<form><label>Email<input required></label><button>Submit</button></form>`);
 await page.evaluate(()=>{window.clicked=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.clicked++;};});
 const result=await page.evaluate(p=>AssistantAutofill.apply(p,async()=>false),packet);
 assert.equal(result.state,'needs_attention');assert.match(result.detail,/lease changed/);assert.equal(await page.evaluate(()=>window.clicked),0);await page.close();
});

test('uses a generated PDF alternative only when the file control requires it',async()=>{
 const page=await pageFor(`<label>Resume<input type="file" accept=".pdf" required></label>`);
 const result=await page.evaluate(p=>AssistantAutofill.fill(p),{...packet,files:{...packet.files,resume_pdf:{name:'resume.pdf',type:'application/pdf',base64:Buffer.from('%PDF-fixture').toString('base64')}}});
 assert.equal(result.missing.length,0);assert.equal(await page.locator('[type="file"]').evaluate(el=>el.files[0].name),'resume.pdf');await page.close();
});
