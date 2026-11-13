const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {mkdtempSync, rmSync, existsSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const temp = mkdtempSync(path.join(tmpdir(), 'desksentry-browser-'));
const server = spawn(process.execPath, [path.join(__dirname, '../server.js')], {env:{...process.env, PORT:'3102', DB_PATH:path.join(temp,'test.db')}, stdio:'ignore'});
let runningBrowser;
async function cleanup() {
 if (runningBrowser) await runningBrowser.close();
 server.kill(); await new Promise(resolve=>server.exitCode !== null ? resolve() : server.once('exit',resolve));
 rmSync(temp,{recursive:true,force:true});
}
(async()=>{
 for(let i=0;i<100;i++){try{await fetch('http://localhost:3102/api/status');break}catch{await new Promise(r=>setTimeout(r,100))}}
 const browser = runningBrowser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()),args:['--no-sandbox']});
 const page = await browser.newPage({timezoneId:'Asia/Tokyo'});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3102');
 await page.locator('#report-content').waitFor({state:'visible'});
 assert.match(await page.locator('#report-status').innerText(), /Asia\/Tokyo/);
 assert.equal(await page.locator('#report-count').innerText(),'0');
 await page.request.post('http://localhost:3102/api/telemetry',{data:{distance_cm:55,status:'NORMAL',sitting_duration_sec:0}});
 await page.waitForTimeout(1100);
 await page.request.post('http://localhost:3102/api/telemetry',{data:{distance_cm:20,status:'VIOLATION',sitting_duration_sec:1}});
 await page.locator('#report-day').click();
 await page.waitForFunction(()=>document.getElementById('report-count').textContent==='1');
 assert.match(await page.locator('#report-sessions').innerText(),/In progress/);
 await page.request.post('http://localhost:3102/api/telemetry',{data:{distance_cm:100,status:'VACANT',sitting_duration_sec:0}});
 await page.locator('#report-week').click();
 await page.waitForFunction(()=>document.querySelectorAll('#report-days li').length===7);
 assert.equal(await page.locator('#report-count').innerText(),'1');
 assert.equal(await page.locator('#report-week').getAttribute('aria-pressed'),'true');
 const invalid=await page.request.get('http://localhost:3102/api/reports?period=month'); assert.equal(invalid.status(),400);
 const invalidZone=await page.request.get('http://localhost:3102/api/reports?time_zone=bad'); assert.equal(invalidZone.status(),400);
 await page.route('**/api/reports?**',route=>route.fulfill({status:500,body:'{}'}));
 await page.locator('#report-day').click();
 await page.waitForFunction(()=>document.getElementById('report-status').textContent.includes('unavailable'));
 assert.equal(await page.locator('#report-content').isVisible(),false);
 await page.unroute('**/api/reports?**');
 await page.locator('#report-day').click(); await page.locator('#report-content').waitFor({state:'visible'});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);

 await page.setViewportSize({width:1365,height:1100});

 assert.deepEqual(errors,[]); await browser.close();
 console.log('PASS: real HTTP telemetry + UI day/week + timezone + validation + failed request/retry + mobile layout; no page errors');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(cleanup);
