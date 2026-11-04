const {chromium}=require('/workspace/nimbles-mockup/node_modules/playwright');
(async()=>{const [,,html,png,w,scale]=process.argv;const b=await chromium.launch();const p=await b.newPage({viewport:{width:+w,height:600},deviceScaleFactor:+(scale||1.5)});
await p.goto('file://'+html);await p.waitForTimeout(300);await p.screenshot({path:png,fullPage:true});await b.close();})();
