// Run with: flock -w 120 /workspace/portfolio/heavy-build.lock node tests/dashboard.browser.mjs
// This browser test uses a temporary local workspace and injected provider fixtures.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { createWorkspaceService } from '../apps/api/src/workspace-service.js';
import { createWorkspaceHandler } from '../apps/api/src/workspace.js';
import { FileWorkspaceStore } from '../apps/api/src/workspace-storage.js';

const fixtureToken = 'browser-fixture-founder-token';
const connectorFixtures = {
  shopify: {label:'Shopify',configured:false,mode:'provider_read',capabilities:['connector_sync'],limitation:'Catalogue reads need a configured founder-owned account. No writes.'},
  woocommerce: {label:'WooCommerce',configured:true,mode:'provider_read',capabilities:['connector_sync'],limitation:'Injected test catalogue only. No real provider requests.'},
  cj: {label:'CJdropshipping',configured:false,mode:'provider_read',capabilities:['connector_sync'],limitation:'Supplier reads require configured account credentials.'},
  alibaba: {label:'Alibaba',configured:false,mode:'reference_preparation',capabilities:['supplier_reference'],limitation:'Local references remain unverified. No authenticated marketplace API.'},
  made_in_china: {label:'Made-in-China',configured:false,mode:'reference_preparation',capabilities:['supplier_reference'],limitation:'Unverified manual supplier reference.'},
  '1688': {label:'1688',configured:false,mode:'reference_preparation',capabilities:['supplier_reference'],limitation:'Unverified manual supplier reference.'},
  temu: {label:'Temu',configured:false,mode:'reference_preparation',capabilities:['supplier_reference'],limitation:'Unverified manual supplier reference.'},
  zendrop: {label:'Zendrop',configured:false,mode:'reference_preparation',capabilities:['supplier_reference'],limitation:'Unverified manual supplier reference.'},
  direct: {label:'Direct supplier',configured:false,mode:'reference_preparation',capabilities:['supplier_reference'],limitation:'Unverified manual supplier reference.'},
  google_ads: {label:'Google Ads',configured:false,mode:'provider_read',capabilities:['connector_sync','ad_draft'],limitation:'Configured account reads and local drafts only. No publishing or spend.'},
  meta_ads: {label:'Meta Ads',configured:false,mode:'provider_read',capabilities:['connector_sync','ad_draft'],limitation:'Configured account reads and local drafts only. No publishing or spend.'},
  tiktok_ads: {label:'TikTok Ads',configured:false,mode:'provider_read',capabilities:['connector_sync','ad_draft'],limitation:'Configured account reads and local drafts only. No publishing or spend.'}
};

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(),'wecommerce-dashboard-'));
  const html = await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const requests = [];
  const executions = [];
  const flags = {failNextRefresh:false,loseNextProposalResponse:false,rejectAccess:false,failPublicPlan:false};
  const store = new FileWorkspaceStore({directory});
  const env = {NODE_ENV:'test',WE_COMMERCE_AUTH_TOKEN:fixtureToken};
  const service = createWorkspaceService({store,env,connectorStatus:() => structuredClone(connectorFixtures),runConnectorTask:async task => {
    executions.push(structuredClone(task));
    if (task.kind === 'connector_sync') {
      if (!connectorFixtures[task.provider].configured) throw Object.assign(new Error('fixture missing configuration'),{code:'not_configured'});
      return {summary:'Injected fixture catalogue read completed. No real provider was contacted.',mode:'provider_read',data:{products:[{id:'fixture-product-001',title:'<img src=x onerror="window.providerInjection=1">'}]}};
    }
    if (task.kind === 'supplier_reference') return {summary:'Prepared an unverified local supplier reference. No supplier account was connected.',mode:'reference_preparation',data:{provider:task.provider,...task.params,verified:false}};
    if (task.kind === 'ad_draft') return {summary:'Prepared a local campaign draft. No ad was published and no budget was spent.',mode:'local_draft',data:{provider:task.provider,...task.params,published:false}};
    throw Object.assign(new Error('fixture unsupported operation'),{code:'unsupported_operation'});
  }});
  const handler = createWorkspaceHandler({env,service});
  const server = createServer(async (req,res) => {
    const path = new URL(req.url,'http://localhost').pathname;
    requests.push({path,method:req.method,authorization:req.headers.authorization,idempotencyKey:req.headers['idempotency-key']});
    res.setHeader('cache-control','no-store');
    if (path === '/api/workspace') {
      if (flags.rejectAccess) { res.writeHead(401,{'content-type':'application/json'}); res.end(JSON.stringify({error:'Fixture access revoked.',code:'unauthorized'})); return; }
      if (req.method === 'GET' && flags.failNextRefresh) { flags.failNextRefresh = false; res.writeHead(503,{'content-type':'application/json'}); res.end(JSON.stringify({error:'Fixture workspace temporarily unavailable.',code:'storage_unavailable'})); return; }
      if (req.method === 'POST' && flags.loseNextProposalResponse) {
        flags.loseNextProposalResponse = false;
        const originalEnd = res.end.bind(res);
        res.end = function () { res.statusCode = 502; originalEnd(JSON.stringify({error:'Fixture response was lost after the action was saved.',code:'response_lost'})); };
      }
      await handler(req,res); return;
    }
    if (path === '/api/health') { res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({ok:true,connectors:{shopify:{configured:false},stripe:{configured:false}}})); return; }
    if (path === '/api/onboarding/plan') {
      if (flags.failPublicPlan) { res.writeHead(503,{'content-type':'application/json'}); res.end('{}'); return; }
      res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({steps:['Review <img src=x onerror="window.planInjection=1">','Calculate costs','Check suppliers','Review approved tasks']})); return;
    }
    if (path === '/' || path === '/favicon.ico') { res.writeHead(200,{'content-type':'text/html; charset=utf-8'}); res.end(html); return; }
    res.writeHead(404); res.end();
  }).listen(0,'127.0.0.1');
  await once(server,'listening');
  return {directory,requests,executions,flags,service,origin:`http://127.0.0.1:${server.address().port}`,async close() { await new Promise(resolve => server.close(resolve)); await service.close(); await rm(directory,{recursive:true,force:true}); }};
}

async function textIncludes(page,selector,text) {
  await page.waitForFunction(({selector,text}) => document.querySelector(selector)?.textContent.includes(text),{selector,text});
}
async function action(page,actionName,button) {
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/workspace') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === actionName);
  await button.click();
  const response = await responsePromise;
  const body = await response.json();
  await page.waitForFunction(() => document.getElementById('workspace').getAttribute('aria-busy') === 'false' || document.getElementById('workspace').hidden);
  return {response,body,request:response.request().postDataJSON()};
}
async function refresh(page,button) {
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/workspace') && response.request().method() === 'GET');
  await button.click();
  const response = await responsePromise;
  await page.waitForFunction(() => document.getElementById('workspace').getAttribute('aria-busy') === 'false' || document.getElementById('workspace').hidden);
  return response;
}
async function openWorkspace(page,token = fixtureToken) {
  await page.locator('#access-token').fill(token);
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/workspace'));
  await page.getByRole('button',{name:'Open workspace',exact:true}).click();
  const response = await responsePromise;
  if (response.ok()) await page.locator('#workspace').waitFor({state:'visible'});
  else await textIncludes(page,'#access-feedback','Access rejected');
  return response;
}
async function propose(page,fixture) {
  const before = new Set((await fixture.service.workspace()).tasks.map(task => task.id));
  const result = await action(page,'create_task',page.getByRole('button',{name:'Explain this task',exact:true}));
  assert.equal(result.response.status(),200);
  const task = result.body.tasks.find(item => !before.has(item.id));
  assert.ok(task,'new immutable task was saved');
  return {task,card:page.locator(`[data-task-id="${task.id}"]`),request:result.request};
}
async function approveAndExecute(page,proposal) {
  const approve = proposal.card.getByRole('button',{name:'Approve exact task',exact:true});
  assert.equal(await approve.isDisabled(),true);
  await proposal.card.getByRole('checkbox',{name:'I reviewed the explanation and saved inputs for this task',exact:true}).check();
  const approval = await action(page,'approve_task',approve);
  assert.equal(approval.response.status(),200);
  assert.equal(approval.body.tasks.find(item => item.id === proposal.task.id).status,'approved');
  const execution = await action(page,'execute_task',proposal.card.getByRole('button',{name:'Execute approved task',exact:true}));
  assert.equal(execution.response.status(),200);
  return execution.body.tasks.find(item => item.id === proposal.task.id);
}

test('founder dashboard exercises authenticated server state without external provider writes', {timeout:120000}, async t => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.CHROMIUM_EXECUTABLE_PATH} : {}),
    headless:true,args:['--no-sandbox','--disable-dev-shm-usage']
  });
  t.after(() => browser.close());
  const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const unexpectedNetwork = [];
  await context.route('**/*', async route => { const url = route.request().url(); if (url.startsWith(fixture.origin + '/')) await route.continue(); else { unexpectedNetwork.push(url); await route.abort(); } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror',error => pageErrors.push(error.message));
  page.on('dialog',async dialog => { pageErrors.push('Unexpected dialog: ' + dialog.message()); await dialog.dismiss(); });
  await page.goto(fixture.origin,{waitUntil:'domcontentloaded'});

  await t.test('public guidance is available while the founder state requires an in-memory token', async () => {
    assert.equal(await page.locator('#workspace').isVisible(),false);
    assert.equal(fixture.requests.some(request => request.path === '/api/workspace'),false);
    await textIncludes(page,'#onboarding-steps','Review <img');
    assert.equal(await page.locator('#onboarding-steps img').count(),0);
    assert.equal(await page.evaluate(() => window.planInjection),undefined);
    assert.equal((await openWorkspace(page,'incorrect-fixture-token')).status(),401);
    assert.equal(await page.locator('#workspace').isVisible(),false);
    assert.equal((await openWorkspace(page)).status(),200);
    assert.equal(await page.locator('#access-token').inputValue(),'');
    assert.deepEqual(await page.evaluate(() => ({local:Object.keys(localStorage),session:Object.keys(sessionStorage)})),{local:[],session:[]});
    assert.ok(fixture.requests.filter(request => request.path === '/api/workspace').every(request => request.authorization?.startsWith('Bearer ')));
    assert.equal(page.url(),fixture.origin + '/');
    assert.equal((await page.content()).includes(fixtureToken),false);
    assert.equal(await page.getByRole('button',{name:'Explain this task',exact:true}).isDisabled(),true);
  });

  await t.test('profile saving unlocks tasks and preserves text without HTML execution', async () => {
    await page.locator('#brand-name').fill('Quiet River <svg onload="window.profileInjection=1">');
    await page.locator('#profile-niche').fill('Pet Products');
    await page.locator('#target-country').fill('United States');
    await page.locator('#profile-currency').fill('USD');
    await page.locator('#profile-goal').fill('Compare unit economics.\nReview fulfillment evidence.');
    const saved = await action(page,'save_profile',page.getByRole('button',{name:'Save founder profile',exact:true}));
    assert.equal(saved.response.status(),200);
    assert.equal(saved.body.profile.niche,'Pet Products');
    await textIncludes(page,'#workspace-heading','<svg');
    assert.equal(await page.locator('#workspace-heading svg').count(),0);
    assert.equal(await page.evaluate(() => window.profileInjection),undefined);
    await page.locator('#brand-name').fill('Quiet River');
    await textIncludes(page,'#profile-state','Unsaved changes');
    await textIncludes(page,'#task-capability-note','proposal uses the last saved profile');
    assert.equal((await action(page,'save_profile',page.getByRole('button',{name:'Save founder profile',exact:true}))).response.status(),200);
    assert.equal(await page.getByRole('button',{name:'Explain this task',exact:true}).isEnabled(),true);
    await page.locator('#task-kind').selectOption('ad_draft');
    assert.equal(await page.getByRole('button',{name:'Explain this task',exact:true}).isDisabled(),true);
    await textIncludes(page,'#task-capability-note','Complete the founder exercises');
    await page.locator('#task-kind').selectOption('onboarding_plan');
  });

  await t.test('complete and incomplete niche observations retain their evidence limits', async () => {
    const first = page.locator('.observation').first();
    for (const [name,value] of Object.entries({niche:'Pet Products',retailPrice:'100',productCost:'30',shippingCost:'5',fees:'5',acquisitionCost:'10'})) await first.locator(`[name="${name}"]`).fill(value);
    await page.getByRole('button',{name:'Add observation',exact:true}).click();
    const second = page.locator('.observation').nth(1);
    for (const [name,value] of Object.entries({niche:'Home & Kitchen',retailPrice:'80',productCost:'20',fees:'2'})) await second.locator(`[name="${name}"]`).fill(value);
    const saved = await action(page,'score_niches',page.getByRole('button',{name:'Calculate margins',exact:true}));
    assert.equal(saved.response.status(),200);
    assert.equal(saved.body.scores[0].contributionMargin,50);
    assert.equal(saved.body.scores[0].marginPercent,50);
    assert.equal(saved.body.scores[1].contributionMargin,null);
    assert.equal(saved.body.scores[1].rank,null);
    assert.deepEqual(saved.body.scores[1].missingInputs,['shippingCost','acquisitionCost']);
    assert.equal(Object.hasOwn(saved.request.observations[1],'shippingCost'),false);
    await textIncludes(page,'#niche-scores','50.00 USD');
    await textIncludes(page,'#niche-scores','No rank assigned');
    await textIncludes(page,'#niche-scores','Demand evidence, Supplier reliability evidence');
  });

  await t.test('guidance and provider tasks require explicit approval and report their real modes', async () => {
    const guidance = await propose(page,fixture);
    assert.equal(guidance.task.status,'proposed');
    assert.equal(guidance.task.profileSnapshot.brandName,'Quiet River');
    assert.equal(await guidance.card.getByRole('button',{name:'Execute approved task',exact:true}).count(),0);
    await textIncludes(page,`[data-task-id="${guidance.task.id}"]`,'Quiet River');
    const guidanceResult = await approveAndExecute(page,guidance);
    assert.equal(guidanceResult.result.mode,'local_guidance');
    await textIncludes(page,`[data-task-id="${guidance.task.id}"]`,'Local guidance prepared');
    assert.equal(await guidance.card.getByRole('button',{name:'Execute approved task',exact:true}).count(),0);
    await page.locator('#task-kind').selectOption('connector_sync');
    await page.locator('#task-provider').selectOption('shopify');
    await textIncludes(page,'#task-capability-note','credentials are missing');
    const blocked = await propose(page,fixture);
    const blockedResult = await approveAndExecute(page,blocked);
    assert.equal(blockedResult.status,'blocked');
    assert.equal(blockedResult.result.code,'not_configured');
    await textIncludes(page,`[data-task-id="${blocked.task.id}"]`,'No provider action was performed');
    assert.equal(await blocked.card.getByRole('button',{name:'Execute approved task',exact:true}).count(),0);
    await page.locator('#task-provider').selectOption('woocommerce');
    const read = await propose(page,fixture);
    const readResult = await approveAndExecute(page,read);
    assert.equal(readResult.result.mode,'provider_read');
    await textIncludes(page,`[data-task-id="${read.task.id}"]`,'Verified provider read');
    assert.equal(await read.card.locator('img').count(),0);
    assert.equal(await page.evaluate(() => window.providerInjection),undefined);
    await textIncludes(page,'[data-provider="shopify"]','Credentials missing');
    await textIncludes(page,'[data-provider="woocommerce"]','Configuration alone does not verify');
  });

  await t.test('supplier selection prepares an unverified local reference', async () => {
    await page.locator('#task-kind').selectOption('supplier_reference');
    await page.locator('#task-provider').selectOption('alibaba');
    await page.locator('#reference-url').fill('https://www.alibaba.com/product-detail/fixture-reference.html');
    await page.locator('#reference-title').fill('Reference <img src=x onerror="window.referenceInjection=1">');
    await page.locator('#reference-notes').fill('Check identity and samples.\nAsk for fulfillment terms.');
    const proposal = await propose(page,fixture);
    const result = await approveAndExecute(page,proposal);
    assert.equal(result.result.mode,'reference_preparation');
    assert.equal(result.result.data.verified,false);
    await textIncludes(page,`[data-task-id="${proposal.task.id}"]`,'Unverified reference prepared');
    assert.equal(await proposal.card.locator('img').count(),0);
    assert.equal(await page.evaluate(() => window.referenceInjection),undefined);
    await textIncludes(page,'[data-provider="alibaba"]','Reference only · unverified');
  });

  await t.test('server prerequisites and exercise validation govern progression and draft access', async () => {
    const margin = page.locator('[data-lesson-id="margin_basics"]');
    const suppliers = page.locator('[data-lesson-id="supplier_checks"]');
    const approval = page.locator('[data-lesson-id="approval_safety"]');
    assert.equal(await suppliers.getByRole('button',{name:'Submit exercise',exact:true}).isDisabled(),true);
    assert.equal(await approval.getByRole('button',{name:'Submit exercise',exact:true}).isDisabled(),true);
    for (const [name,value] of Object.entries({retailPrice:'100',totalCosts:'70',margin:'25'})) await margin.locator(`[name="${name}"]`).fill(value);
    const wrong = await action(page,'complete_lesson',margin.getByRole('button',{name:'Submit exercise',exact:true}));
    assert.equal(wrong.response.ok(),false);
    assert.equal((await fixture.service.workspace()).curriculum.completedCount,0);
    assert.equal(await page.locator('#workspace-error').isVisible(),true);
    assert.equal(await suppliers.getByRole('button',{name:'Submit exercise',exact:true}).isDisabled(),true);
    await margin.locator('[name="margin"]').fill('30');
    const complete = await action(page,'complete_lesson',margin.getByRole('button',{name:'Submit exercise',exact:true}));
    assert.equal(complete.response.status(),200);
    assert.equal(complete.body.curriculum.completedCount,1);
    assert.equal(await suppliers.getByRole('button',{name:'Submit exercise',exact:true}).isEnabled(),true);
    await suppliers.getByRole('checkbox',{name:'Demand evidence',exact:true}).check();
    await suppliers.getByRole('checkbox',{name:'Supplier reliability evidence',exact:true}).check();
    const evidence = await action(page,'complete_lesson',suppliers.getByRole('button',{name:'Submit exercise',exact:true}));
    assert.deepEqual(evidence.request.exercise.evidenceNeeded,['demand','supplier_reliability']);
    assert.equal(evidence.body.curriculum.completedCount,2);
    await approval.getByRole('checkbox').check();
    const acknowledged = await action(page,'complete_lesson',approval.getByRole('button',{name:'Submit exercise',exact:true}));
    assert.deepEqual(acknowledged.request.exercise,{acknowledgement:'approve_exact_payload'});
    assert.equal(acknowledged.body.curriculum.completedCount,3);
    assert.ok(acknowledged.body.curriculum.unlockedControls.includes('ad_draft'));
    await page.locator('#task-kind').selectOption('ad_draft');
    assert.equal(await page.getByRole('button',{name:'Explain this task',exact:true}).isEnabled(),true);
  });

  await t.test('advertising selection creates a local draft with no provider credentials or spend', async () => {
    await page.locator('#task-provider').selectOption('meta_ads');
    await page.locator('#ad-headline').fill('Everyday essentials for your pet');
    await page.locator('#ad-description').fill('Review this draft copy.\nClaims need independent review.');
    await page.locator('#ad-destination').fill('https://example.com/pet-essentials');
    await page.locator('#ad-budget').fill('12.50');
    await page.locator('#ad-currency').fill('USD');
    const proposal = await propose(page,fixture);
    assert.deepEqual(proposal.request.params,{headline:'Everyday essentials for your pet',description:'Review this draft copy.\nClaims need independent review.',destinationUrl:'https://example.com/pet-essentials',budgetDaily:12.5,currency:'USD'});
    const result = await approveAndExecute(page,proposal);
    assert.equal(result.result.mode,'local_draft');
    assert.equal(result.result.data.published,false);
    await textIncludes(page,`[data-task-id="${proposal.task.id}"]`,'No ad was published and no budget was spent');
    assert.equal((JSON.stringify(proposal.request)).includes('token'),false);
  });

  await t.test('refresh errors and ambiguous mutation responses reconcile saved state without replay', async () => {
    fixture.flags.failNextRefresh = true;
    assert.equal((await refresh(page,page.getByRole('button',{name:'Refresh workspace',exact:true}))).status(),503);
    assert.equal(await page.locator('#workspace').isVisible(),true);
    await textIncludes(page,'#workspace-error-message','temporarily unavailable');
    assert.equal((await refresh(page,page.getByRole('button',{name:'Retry workspace refresh',exact:true}))).status(),200);
    assert.equal(await page.locator('#workspace-error').isVisible(),false);
    const before = (await fixture.service.workspace()).tasks.length;
    await page.locator('#task-kind').selectOption('onboarding_plan');
    fixture.flags.loseNextProposalResponse = true;
    const lost = await action(page,'create_task',page.getByRole('button',{name:'Explain this task',exact:true}));
    assert.equal(lost.response.status(),502);
    await textIncludes(page,'#workspace-error-message','response was lost');
    assert.equal((await fixture.service.workspace()).tasks.length,before + 1);
    assert.equal((await refresh(page,page.getByRole('button',{name:'Retry workspace refresh',exact:true}))).status(),200);
    assert.equal((await fixture.service.workspace()).tasks.length,before + 1);
    await textIncludes(page,'#task-count',String(before + 1));
    await textIncludes(page,'#lesson-progress','3 / 3');
  });

  await t.test('the workspace fits mobile, exposes accessible action labels, and clears access on lock and reload', async () => {
    const artifactDirectory = process.env.WE_COMMERCE_BROWSER_ARTIFACTS || '/workspace/portfolio/wecommerce-dashboard';
    await mkdir(artifactDirectory,{recursive:true});
    await page.locator('#workspace-heading').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(artifactDirectory,'desktop.png')});
    await page.locator('#tasks').evaluate(element => element.scrollIntoView({block:'start'}));
    await page.screenshot({path:join(artifactDirectory,'tasks.png')});
    await page.setViewportSize({width:390,height:844});
    await page.locator('#workspace-heading').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true);
    const saveButton = await page.getByRole('button',{name:'Save founder profile',exact:true}).boundingBox();
    assert.ok(saveButton.height >= 44);
    await page.screenshot({path:join(artifactDirectory,'mobile.png')});
    await page.getByRole('button',{name:'Lock workspace',exact:true}).click();
    assert.equal(await page.locator('#workspace').isVisible(),false);
    assert.equal(await page.locator('#task-list').textContent(),'');
    assert.equal(await page.locator('#brand-name').inputValue(),'');
    assert.deepEqual(await page.evaluate(() => ({local:Object.keys(localStorage),session:Object.keys(sessionStorage)})),{local:[],session:[]});
    await openWorkspace(page);
    assert.equal(await page.locator('.observation').first().locator('[name="retailPrice"]').inputValue(),'100');
    assert.equal(await page.locator('.observation').nth(1).locator('[name="shippingCost"]').inputValue(),'');
    const requestsBeforeReload = fixture.requests.filter(request => request.path === '/api/workspace').length;
    await page.reload({waitUntil:'domcontentloaded'});
    assert.equal(await page.locator('#workspace').isVisible(),false);
    assert.equal(fixture.requests.filter(request => request.path === '/api/workspace').length,requestsBeforeReload);
    await openWorkspace(page);
    fixture.flags.rejectAccess = true;
    assert.equal((await refresh(page,page.getByRole('button',{name:'Refresh workspace',exact:true}))).status(),401);
    assert.equal(await page.locator('#workspace').isVisible(),false);
    assert.equal(await page.locator('#task-list').textContent(),'');
    await textIncludes(page,'#access-feedback','Access was rejected or expired');
    fixture.flags.rejectAccess = false;
    fixture.flags.failPublicPlan = true;
    await page.reload({waitUntil:'domcontentloaded'});
    await textIncludes(page,'#onboarding-steps','Public checklist unavailable');
    assert.equal(await page.getByRole('button',{name:'Retry checklist',exact:true}).isVisible(),true);
    fixture.flags.failPublicPlan = false;
    await page.getByRole('button',{name:'Retry checklist',exact:true}).click();
    await textIncludes(page,'#onboarding-steps','Calculate costs');
  });

  assert.deepEqual(unexpectedNetwork,[],'all browser traffic stayed on the injected local API');
  assert.deepEqual(pageErrors,[],'no script errors, HTML injection, or unexpected dialogs');
  assert.ok(fixture.executions.every(task => ['connector_sync','supplier_reference','ad_draft'].includes(task.kind)));
});
