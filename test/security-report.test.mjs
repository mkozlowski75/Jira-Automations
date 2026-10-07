import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { render, runRule } from './helpers/security-automation-fixture.mjs';
const rule = id => JSON.parse(readFileSync(new URL(`../../jira-automation-rules/rules/CER-jira-rule-${id}.json`,import.meta.url),'utf8'));
const alert = rule(1062), productionAlert = rule(1029), worker = rule(914);
const flat = cs => cs.flatMap(c => [c,...flat(c.children ?? []),...flat(c.conditions ?? [])]);
const finding = (id,severity='HIGH',library='library') => ({VulnerabilityID:id,Severity:severity,PkgName:library,InstalledVersion:'1.0'});
const issue = (key,id,status='Open') => ({key,summary:`[CVE] ${id} – library`,description:`Finding ${id}`,status:{name:status}});
// Change a selected finding and its carried record together. Contradictory
// payloads are separate ingress-error cases, not parameter-validation cases.
function selectedFields(payload,patch) {
  const changed={...payload,...patch};
  if(payload.findingRows) {
    const rows=[...new Set(payload.findingRows.split('§§').filter(Boolean))];
    rows[Number(payload.position)]=['findingId','library','installedVersion','severity'].map(k=>changed[k]??'').join('¤');
    changed.findingRows=rows.join('§§')+'§§';
  }
  return changed;
}
function scenario(findings, existing = [], { indexLag = false, statusChange = false, lookupLimit = 100, callerId = 1062 } = {}) {
  const all = [...existing], events = [], posts = [], gets = [
    [{id:42,iid:7,sha:'1234567890'}],
    [{id:55,name:'trivy:scan:sbom: [trivy, $TRIVY_SBOM]',web_url:'https://gitlab.partner.bdr.de/cer/ceroma/app/-/jobs/55',stage:'sbom-vun',status:'success'}],
    {Results:[{Vulnerabilities:findings}]},
  ];
  let lookupCount = 0;
  const handlers = {
    get: () => gets.shift(),
    lookup: query => {
      if (++lookupCount > 1 && statusChange) all[0].status = {name:'Done'};
      const ids = query.match(/CVE-\d{4}-\d{4,24}|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/g) ?? [];
      return all.filter(x => (!indexLag || existing.includes(x)) && ids.some(id => `${x.summary} ${x.description}`.includes(id)) && (!query.includes('statusCategory != Done') || x.status.name !== 'Done')).slice(0,lookupLimit);
    },
    create: fields => { const x = {key:`CER-${9000+all.length}`,summary:fields.summary,description:fields.description,status:{name:'Open'}}; all.unshift(x); return x; },
  };
  const start = runRule(callerId === 1029 ? productionAlert : alert,{},handlers); events.push(...start.events); posts.push(...start.events.filter(e=>e.type==='post').map(e=>e.payload));
  let executions = 0;
  while (posts.length) {
    assert.ok(++executions <= (callerId === 1029 ? 5 : 2),'Chain must stop within the caller limit');
    const result = runRule(worker,{webhookData:posts.shift()},handlers);
    events.push(...result.events); posts.push(...result.events.filter(e=>e.type==='post').map(e=>e.payload));
  }
  return {events,all,executions,emails:events.filter(e=>e.type==='email'),created:events.filter(e=>e.type==='create')};
}
test('1062 reports every severity but only checks first two eligible HIGH/CRITICAL tuples',()=>{
  const s = scenario(['UNKNOWN','LOW','MEDIUM','HIGH','CRITICAL'].map((severity,i)=>finding(`CVE-2026-${1000+i}`,severity)));
  assert.equal(s.created.length,2); assert.equal(s.executions,2); assert.equal(s.emails.length,1);
  assert.deepEqual(s.created.map(c=>c.fields.summary.match(/CVE-2026-\d+/)[0]),['CVE-2026-1003','CVE-2026-1004']);
  assert.deepEqual(s.events.filter(e=>e.type==='post').map(e=>e.payload.severity),['HIGH','CRITICAL']);
  const mail = s.emails[0]; assert.deepEqual(mail.to,[{type:'FREE',value:'matthias.kozlowski.extern@bdr.de'}]); assert.deepEqual(mail.cc,[]); assert.deepEqual(mail.bcc,[]);
  assert.match(mail.body,/>Jira-Tickets</); assert.doesNotMatch(mail.body,/@ @|@@TICKET:/);
  for (const c of s.created) assert.match(mail.body,new RegExp(`browse/${c.key}`));
  for (const severity of ['UNKNOWN','LOW','MEDIUM','HIGH','CRITICAL']) assert.ok(mail.body.includes(severity));
  assert.equal((mail.body.match(/<tr>/g)??[]).length,5);
  assert.match(mail.body,/ersten zwei.*Schweregrade HIGH und CRITICAL/);
  assert.ok(s.events.filter(e=>e.type==='commentBranch').every(e=>e.notifications.every(n=>n===false)));
});
test('closed and open tickets prevent recreation; all statuses and rows beyond two get links',()=>{
  const findings = [finding('CVE-2026-1000'),finding('GHSA-aaaa-bbbb-cccc','MEDIUM'),finding('CVE-2026-1002')];
  const s = scenario(findings,[issue('CER-1','CVE-2026-1000','Done'),issue('CER-2','CVE-2026-1000','In Progress'),issue('CER-3','GHSA-aaaa-bbbb-cccc'),issue('CER-4','CVE-2026-1002','Done')]);
  assert.equal(s.created.length,0); assert.equal(s.emails.length,1);
  for (const key of ['CER-1','CER-2','CER-3','CER-4']) assert.ok(s.emails[0].body.includes(`browse/${key}`));
  assert.ok(s.emails[0].body.includes('(Done)')); assert.ok(s.emails[0].body.includes('(In Progress)'));
});
test('same identifier in two libraries does not create twice even before search index sees first ticket',()=>{
  const s = scenario([finding('CVE-2026-1000','HIGH','library-a'),finding('CVE-2026-1000','CRITICAL','library-b')],[],{indexLag:true});
  assert.equal(s.created.length,1); assert.equal(s.emails.length,1);
  assert.equal((s.emails[0].body.match(/browse\/CER-9000/g)??[]).length,2);
});
test('report with no eligible identifiers still sends overview with empty ticket cells',()=>{
  const s = scenario([finding('OTHER-123','LOW')]); assert.equal(s.created.length,0); assert.equal(s.emails.length,1); assert.equal(s.executions,1);
  assert.doesNotMatch(s.emails[0].body,/browse\/|@@TICKET:/); assert.match(s.emails[0].body,/<td[^>]*><\/td>/);
});
test('1062 with only lower severities sends all rows and existing ticket links without creating tickets',()=>{
  const severities=['UNKNOWN','LOW','MEDIUM'];
  const s=scenario(severities.map((severity,i)=>finding(`CVE-2026-${1100+i}`,severity)),[issue('CER-1','CVE-2026-1101','Done')]);
  assert.equal(s.created.length,0);assert.equal(s.executions,1);assert.equal(s.emails.length,1);
  assert.ok(!s.events.some(e=>['comment','commentBranch'].includes(e.type)));
  const payload=s.events.find(e=>e.type==='post').payload;
  assert.equal(payload.findingRows,'');assert.equal(payload.findingId,'');
  const mail=s.emails[0].body;
  assert.equal((mail.match(/<tr>/g)??[]).length,3);
  for(const severity of severities)assert.ok(mail.includes(severity));
  assert.match(mail,/browse\/CER-1/);assert.match(mail,/\(Done\)/);assert.doesNotMatch(mail,/@@TICKET:/);
});

test('1062 lower severities do not consume slots and existing HIGH tickets still consume one of two slots',()=>{
  const findings=[finding('CVE-2026-1200','LOW'),finding('CVE-2026-1201','MEDIUM'),finding('CVE-2026-1202','HIGH'),finding('CVE-2026-1203','CRITICAL'),finding('CVE-2026-1204','HIGH')];
  const s=scenario(findings,[issue('CER-1','CVE-2026-1202','Closed')]);
  assert.equal(s.executions,2);assert.equal(s.created.length,1);assert.equal(s.emails.length,1);
  assert.match(s.created[0].fields.summary,/CVE-2026-1203/);
  assert.equal((s.emails[0].body.match(/<tr>/g)??[]).length,5);
  assert.match(s.emails[0].body,/browse\/CER-1/);assert.match(s.emails[0].body,/\(Closed\)/);
});

test('914 skips a lower severity in the first report step but hands off and sends the final overview',()=>{
  for(const callerId of [1062,1029]) {
    const first=scenario([finding('CVE-2026-1300'),finding('CVE-2026-1301')],[],{callerId}).events.find(e=>e.type==='post').payload;
    const skipped=runRule(worker,{webhookData:selectedFields(first,{severity:'LOW'})},{create:()=>{throw Error('Lower severity created a ticket');}});
    assert.ok(!skipped.events.some(e=>['lookup','create','comment','email'].includes(e.type)));
    const posts=skipped.events.filter(e=>e.type==='post');assert.equal(posts.length,1);
    const final=runRule(worker,{webhookData:posts[0].payload},{lookup:()=>[],create:()=>issue('CER-1','CVE-2026-1301')});
    assert.equal(final.events.filter(e=>e.type==='create').length,1);assert.equal(final.events.filter(e=>e.type==='email').length,1);
    const mail=final.events.find(e=>e.type==='email').body;
    assert.ok(mail.includes('CVE-2026-1300'));assert.ok(mail.includes('CVE-2026-1301'));assert.ok(mail.includes('browse/CER-1'));
  }
});

test('empty scan sends no overview and starts no worker',()=>{ const s = scenario([]); assert.equal(s.emails.length,0); assert.equal(s.executions,0); });
test('100 returned ticket matches retain incomplete lookup context without showing it in the email',()=>{
  const s = scenario([finding('CVE-2026-1000')],Array.from({length:100},(_,i)=>issue(`CER-${i}`,'CVE-2026-1000')));
  assert.doesNotMatch(s.emails[0].body,/möglicherweise unvollständig|Bereits vorhandene Tickets verhindern/);
  assert.match(s.events.find(e=>e.type==='post').payload.lookupWarning,/möglicherweise unvollständig/);
});
test('fresh ticket status replaces the initial status without duplicate links',()=>{
  const s = scenario([finding('CVE-2026-1000')],[issue('CER-1','CVE-2026-1000','Open')],{statusChange:true});
  assert.equal((s.emails[0].body.match(/browse\/CER-1"/g)??[]).length,1);
  assert.match(s.emails[0].body,/\(Done\)/); assert.doesNotMatch(s.emails[0].body,/\(Open\)/);
});
test('unknown configurable lookup limit retains the warning in context rather than the email',()=>{
  const s = scenario([finding('CVE-2026-1000')],Array.from({length:60},(_,i)=>issue(`CER-${i}`,'CVE-2026-1000')),{lookupLimit:50});
  assert.doesNotMatch(s.emails[0].body,/möglicherweise unvollständig/);
  assert.match(s.events.find(e=>e.type==='post').payload.lookupWarning,/möglicherweise unvollständig/);
});
test('mapping matches whole identifiers only and escapes issue status HTML',()=>{
  const s = scenario([finding('CVE-2026-1000')],[issue('CER-12','CVE-2026-10001','<Done>')]);
  assert.equal(s.created.length,1,'A prefix match must not suppress a different identifier');
  assert.doesNotMatch(s.emails[0].body,/browse\/CER-12/);
  const escaped = scenario([finding('CVE-2026-1000')],[issue('CER-12','CVE-2026-1000','<Done>')]);
  assert.match(escaped.emails[0].body,/\(&lt;Done&gt;\)/);
});
test('single-finding worker only creates HIGH/CRITICAL tickets and keeps production recipients',()=>{
  const payload = {findingId:'CVE-2026-1000',library:'library',installedVersion:'1',severity:'HIGH',source:'https://example.org/job'};
  const handlers = {lookup:()=>[],create:()=>issue('CER-1',payload.findingId)};
  for (const severity of ['HIGH','CRITICAL']) {
    const result = runRule(worker,{webhookData:{...payload,severity}},handlers);
    assert.equal(result.events.filter(e=>e.type==='create').length,1);
    assert.equal(result.events.find(e=>e.type==='email').to.length,4);
    assert.doesNotMatch(result.events.find(e=>e.type==='lookup').query,/statusCategory/);
    assert.deepEqual(result.events.find(e=>e.type==='commentBranch').notifications,[true]);
  }
});
test('single-finding worker prevents recreation for every ticket status and matches whole identifiers',()=>{
  const payload = {findingId:'CVE-2026-1000',library:'library',installedVersion:'1',severity:'HIGH',source:'https://example.org/job'};
  for (const status of ['Open','In Progress','Done','Closed']) {
    const result = runRule(worker,{webhookData:payload},{
      lookup:()=>[issue('CER-1',payload.findingId,status)],
      create:()=>{throw new Error(`Existing ${status} ticket must prevent creation`);},
    });
    assert.ok(!result.events.some(e=>['create','commentBranch','comment','email'].includes(e.type)));
    assert.ok(result.events.some(e=>e.type==='log' && e.value.includes('Status unabhängig')));
  }
  const differentId = runRule(worker,{webhookData:payload},{
    lookup:()=>[issue('CER-2','CVE-2026-10001','Done')],
    create:()=>issue('CER-3',payload.findingId),
  });
  assert.equal(differentId.events.filter(e=>e.type==='create').length,1);
});
test('both worker modes only create HIGH/CRITICAL and skip other, missing or invalid severities',()=>{
  const first = scenario([finding('CVE-2026-1000')]).events.find(e=>e.type==='post').payload;
  const single = {findingId:first.findingId,library:first.library,installedVersion:first.installedVersion,source:first.source};
  const handlers = {lookup:()=>[],create:()=>issue('CER-1',first.findingId)};
  for (const payload of [single,first]) {
    for (const severity of ['HIGH','CRITICAL']) {
      const result = runRule(worker,{webhookData:selectedFields(payload,{severity})},handlers);
      assert.equal(result.events.filter(e=>e.type==='create').length,1);
      assert.match(result.events.find(e=>e.type==='create').fields.description,new RegExp(`\\|\\*Schweregrad des Herstellers\\*\\|${severity}\\|`));
    }
    for (const severity of ['UNKNOWN','LOW','MEDIUM',undefined,'','low','IMPORTANT','HIGH|LOW']) {
      const result = runRule(worker,{webhookData:selectedFields(payload,{severity})},handlers);
      assert.ok(!result.events.some(e=>['lookup','create','commentBranch'].includes(e.type)));
      assert.equal(result.events.filter(e=>e.type==='email').length,payload.mode?1:0);
    }
  }
});
test('unknown mode and report origin cannot activate report worker behavior',()=>{
  const handlers = {lookup:()=>{throw new Error('must not search');},create:()=>{throw new Error('must not create');}};
  for (const webhookData of [{mode:'unknown'},{mode:'trivy-report-1062',originRuleId:'1029',position:'0',pipelineId:'42',source:'https://gitlab.partner.bdr.de/cer/ceroma/app/-/jobs/55',reportRows:'test'}]) {
    assert.ok(!runRule(worker,{webhookData},handlers).events.some(e=>['create','post','email'].includes(e.type)));
  }
});

test('native ingress checks accept both report steps and block invalid context before side effects',()=>{
  const s = scenario([finding('CVE-2026-1000'),finding('CVE-2026-1001')]);
  const payloads = s.events.filter(e=>e.type==='post').map(e=>e.payload);
  assert.deepEqual(payloads.map(p=>String(p.position)),['0','1']);
  for (const payload of payloads) {
    const result = runRule(worker,{webhookData:payload},{lookup:()=>[],create:()=>issue('CER-1',payload.findingId)});
    assert.ok(result.events.some(e=>e.type==='log' && e.value.includes('Eingangsprüfung bestanden')));
    assert.equal(result.events.filter(e=>e.type==='create').length,1);
  }
  const first = payloads[0];
  const invalid = [
    ['mode','unknown'],['mode','legacy'],['originRuleId',undefined],['originRuleId','1029'],['originRuleId','legacy'],
    ['position',undefined],['position',''],['position','-1'],['position','2'],['position','01'],
    ['pipelineId',undefined],['pipelineId',''],['pipelineId','not-a-number'],
    ['source',undefined],['source','https://example.org/job'],['source',first.source+'?token=invalid'],
    ['reportRows',undefined],['reportRows',''],
  ];
  for (const [field,value] of invalid) {
    const result = runRule(worker,{webhookData:{...first,[field]:value}},{lookup:()=>{throw Error('Invalid ingress reached lookup');},create:()=>{throw Error('Invalid ingress reached create');}});
    assert.ok(!result.events.some(e=>['lookup','create','commentBranch','post','email'].includes(e.type)),`${field}=${value}`);
    assert.ok(!result.events.some(e=>e.type==='log' && e.value.includes('Eingangsprüfung bestanden')),`${field}=${value}`);
    assert.ok(result.events.some(e=>e.type==='log' && e.value.includes('reportRowsLength=')));
  }
  assert.ok(!flat(worker.components).some(c=>c.value?.name?.value==='securityRequestAccepted'));
});
test('invalid selected finding does not create, still completes report without backfill',()=>{
  const s = scenario([finding('CVE-2026-1000'),finding('CVE-2026-1001')]);
  const first = s.events.find(e=>e.type==='post').payload;
  const bad = selectedFields(first,{library:'invalid|library'});
  const result = runRule(worker,{webhookData:bad},{lookup:()=>[],create:()=>{throw new Error('invalid finding created');}});
  assert.ok(!result.events.some(e=>e.type==='create')); assert.equal(result.events.filter(e=>e.type==='post').length,1);
});
test('second execution links the same tickets without creating them again or filling the third slot',()=>{
  const findings = [finding('CVE-2026-1000'),finding('CVE-2026-1001'),finding('CVE-2026-1002')];
  const first = scenario(findings);
  const second = scenario(findings,first.all);
  assert.equal(first.created.length,2); assert.equal(second.created.length,0); assert.equal(second.emails.length,1);
  for (const created of first.created) assert.ok(second.emails[0].body.includes(`browse/${created.key}`));
  assert.equal(second.all.length,2);
});
test('malformed candidate fields do not consume the two eligible slots; original rows remain escaped',()=>{
  const bad = {...finding('CVE-2026-1000'),PkgName:'invalid|library'};
  const encoded = finding('CVE-2026-1003','HIGH','R&D <package>');
  const s = scenario([bad,finding('CVE-2026-1001'),encoded,finding('CVE-2026-1004')]);
  assert.equal(s.created.length,2);
  assert.ok(s.created.every(x=>!x.fields.summary.includes('CVE-2026-1000')&&!x.fields.summary.includes('CVE-2026-1004')));
  assert.match(s.emails[0].body,/R&amp;D &lt;package&gt;/);
});
test('all own variables are declared before use within their available scope',()=>{
  for (const r of [alert,productionAlert,worker]) {
    const own = new Set(flat(r.components).filter(c=>c.type==='jira.create.variable').map(c=>c.value.name.value));
    function references(value) {
      const strings = v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
      return strings(value).flatMap(v=>[...v.matchAll(/\{\{(.*?)\}\}/gs)]).flatMap(match=>{
        const expression = match[1].replace(/"(?:\\.|[^"\\])*"/g,'');
        return [...expression.matchAll(/(?<![A-Za-z_0-9.])[A-Za-z_][A-Za-z_0-9]*/g)].map(x=>x[0]).filter(name=>own.has(name));
      });
    }
    function walk(cs, available) {
      for (const c of cs) {
        for (const name of references(c.value)) assert.ok(available.has(name),`${r.id}/${c.id}: ${name} used before declaration`);
        if(c.type==='jira.create.variable') available.add(c.value.name.value);
        for(const condition of c.conditions??[]) for(const name of references(condition.value)) assert.ok(available.has(name),`${r.id}/${condition.id}: ${name} condition outside declaration scope`);
        // A conditional or related-issue scope may consume outer declarations;
        // conditional declarations are not assumed available on sibling paths.
        walk(c.children??[],new Set(available));
      }
    }
    walk(r.components,new Set());
  }
});
test('one create component serves both modes; normalized test count has no trailing empty row',()=>{
  assert.equal(flat(worker.components).filter(c=>c.type==='jira.issue.create').length,1);
  const s = scenario([finding('CVE-2026-1000')]); assert.equal(s.executions,1); assert.match(s.emails[0].body,/<strong>1<\/strong>/);
  assert.equal(render('{{value.substringBeforeLast("§§").split("§§").distinct.size}}',{value:'a§§a§§'}),'1');
});
test('the eleven LOW/MEDIUM findings from the failed Jira run produce no tickets and eleven complete rows',()=>{
  const records = [
    ['CVE-2025-15022','com.vaadin:vaadin-server','8.14.3'],
    ['CVE-2025-9467','com.vaadin:vaadin-server','8.14.3'],
    ['CVE-2025-48924','commons-lang:commons-lang','2.6'],
    ['CVE-2026-59230','org.apache.camel:camel-mail','3.22.4'],
    ['CVE-2024-6763','org.eclipse.jetty:jetty-http','10.0.26'],
    ['CVE-2025-11143','org.eclipse.jetty:jetty-http','10.0.26','LOW'],
    ['CVE-2026-6790','org.eclipse.jetty:jetty-server','10.0.26'],
    ['CVE-2026-41711','org.springframework.data:spring-data-commons','2.7.18'],
    ['CVE-2026-41721','org.springframework.data:spring-data-commons','2.7.18'],
    ['CVE-2026-40985','org.springframework.webflow:spring-webflow','2.5.1.RELEASE'],
    ['CVE-2026-40986','org.springframework.webflow:spring-webflow','2.5.1.RELEASE'],
  ];
  const findings = records.map(([VulnerabilityID,PkgName,InstalledVersion,Severity='MEDIUM'])=>({VulnerabilityID,PkgName,InstalledVersion,Severity}));
  const s = scenario(findings);
  const posts = s.events.filter(e=>e.type==='post');
  assert.equal(posts.length,1);
  assert.equal(posts[0].payload.findingRows,'');
  assert.equal(posts[0].payload.findingId,'');
  assert.equal(s.created.length,0); assert.equal(s.emails.length,1);
  assert.equal((s.emails[0].body.match(/<tr>/g)??[]).length,11);
  assert.doesNotMatch(s.emails[0].body,/@@TICKET:/);
});
test('missing, partial and unresolved report tables cannot be emailed',()=>{
  const first = scenario([finding('OTHER-123')]).events.find(e=>e.type==='post').payload;
  const damages = [
    ()=>'',
    value=>value.replace(/<tbody>[\s\S]*<\/tbody>/,'<tbody></tbody>'),
    value=>value.replace('</tbody>','<tr><td>@@TICKET:CVE-2026-1000@@</td></tr></tbody>'),
    value=>value.replace('</tbody>','<tr><td>extra row</td></tr></tbody>'),
  ];
  for (const damage of damages) {
    const result = runRule(worker,{webhookData:first},{variable:(name,value)=>name==='securityReportTable'?damage(value):value});
    assert.ok(!result.events.some(e=>e.type==='email'));
    assert.ok(!result.events.some(e=>e.type==='log' && e.value.includes('Übersicht ausschließlich an Matthias versendet')));
  }
});
test('fixture rejects the failed primitive syntax and requires explicit conditional booleans',()=>{
  assert.throws(()=>render('{{and(exists(a),exists(b),exists(c))}}',{a:'a',b:'b',c:'c'}),/two arguments/);
  assert.throws(()=>render('{{"(".concat(pattern)}}',{pattern:'LOW'}),/literal strings/);
  assert.throws(()=>render('{{#rows}}{{.substringBefore("@@")}}{{/}}',{rows:['row@@']}),/Primitive member access/);
  assert.throws(()=>render('{{#if(value.match("(CVE-2025-15022)"))}}yes{{/}}',{value:'CVE-2025-15022'}),/explicit boolean/);
  assert.equal(render('{{#if(exists(value.match("(CVE-2025-15022)")))}}yes{{/}}',{value:'CVE-2025-15022'}),'yes');
  assert.throws(()=>render('{{#rows}}{{rows.get(index).substringBefore("@@")}}{{/}}',{rows:['first@@','second@@']}),/explicit numeric index/);
  assert.equal(render('{{#rows}}{{html.substringBefore("@@")}}{{/}}',{rows:[{html:'first@@'},{html:'second@@'}]}),'firstsecond');
  assert.equal(render('{{value.split("\\n").size}}',{value:'first\nsecond\n'}),'2');
});

test('worker iterates named objects without implicit indexes and carries all report rows and ticket mappings',()=>{
  const s = scenario([finding('CVE-2026-1000'),finding('CVE-2026-1001'),finding('CVE-2026-1002')],[issue('CER-1','CVE-2026-1000','Done'),issue('CER-2','CVE-2026-1002','Open')]);
  const posts=s.events.filter(e=>e.type==='post');
  assert.equal(posts.length,2);
  for(const {payload} of posts) {
    assert.equal(payload.reportItems.length,3);
    assert.ok(payload.reportItems.every(x=>typeof x.reportFindingId==='string'&&typeof x.reportTicketPattern==='string'));
    assert.deepEqual(JSON.parse('['+payload.reportItemsJson+']'),payload.reportItems);
    assert.ok(payload.ticketItems.every(x=>typeof x.line==='string'));
  }
  assert.ok(posts[1].payload.ticketItems.some(x=>x.line.includes('CER-1')));
  assert.ok(posts[1].payload.ticketItems.some(x=>x.line.includes('CER-2')));
  assert.equal(s.created.length,1);assert.equal(s.emails.length,1);
  assert.doesNotMatch(JSON.stringify(worker.components),/get\(index\)/);
});

test('explicit map separators preserve record boundaries and statuses cannot introduce delimiters',()=>{
  const s=scenario([finding('CVE-2026-1000'),finding('CVE-2026-1001')],[issue('CER-1','CVE-2026-1000','New§§Done'),issue('CER-2','CVE-2026-1001','In Progress\nreview')]);
  const second=s.events.filter(e=>e.type==='post')[1].payload;
  assert.equal(second.ticketIndex.split('§§').filter(Boolean).length,2);
  assert.equal(second.ticketItems.length,2);
  for(const key of ['CER-1','CER-2']) assert.equal((s.emails[0].body.match(new RegExp('browse/'+key+'"','g'))??[]).length,1);
  assert.doesNotMatch(s.emails[0].body,/§§/);
});
test('HTTP acceptance conditions are followed by a real action in both rules',()=>{
  for (const r of [alert,productionAlert,worker]) for (const c of flat(r.components).filter(c=>c.type==='jira.condition.if.block')) {
    assert.notEqual(c.children.at(-1)?.type,'jira.comparator.condition',`${r.id}/${c.id}: terminal condition has no action`);
  }
});

test('Data Center iterators hide outer variables while inline list transformations retain root data',()=>{
  assert.equal(render('{{outside}}{{#rows}}{{outside}}{{label}}{{/}}',{outside:'X',rows:[{label:'A'},{label:'B'}]}),'XAB');
  assert.equal(render('{{rows.concat(outside).join("")}}',{outside:'X',rows:['A','B']}),'AXBX');
  const table=flat(worker.components).find(c=>c.value?.name?.value==='securityReportTable').value.query.value;
  assert.ok(!table.includes('{{#'),'Table must transform rows without a scope-changing iterator');
  const merge=flat(worker.components).find(c=>c.value?.name?.value==='securityReportTicketIndex').value.query.value;
  assert.doesNotMatch(merge,/\{\{#(?:webhookData|security)/,'Carried map must not change context through an iterator');
});

test('created issue data is visible within its IF path and disappears after leaving it',()=>{
  const create = flat(worker.components).find(c=>c.type==='jira.issue.create');
  const log = value=>({type:'codebarrel.action.log',value});
  const condition = {type:'jira.condition.if.block',value:{conditionMatchType:'ALL'},conditions:[],children:[create,log('inside={{createdIssue.key}}')]};
  const result = runRule({components:[condition,log('outside={{createdIssue.key}}')]},{webhookData:{findingId:'CVE-2026-1000'}},{create:()=>issue('CER-1','CVE-2026-1000')});
  assert.deepEqual(result.events.filter(e=>e.type==='log').map(e=>e.value),['inside=CER-1','outside=']);
});

test('report worker comments each freshly created issue despite search index lag',()=>{
  const s = scenario([finding('CVE-2026-1000'),finding('CVE-2026-1001')],[],{indexLag:true});
  const comments = s.events.filter(e=>e.type==='comment');
  assert.equal(comments.length,2);
  assert.deepEqual(comments.map(c=>c.key),s.created.map(c=>c.key));
  for (const c of comments) {
    assert.equal(c.body,`Dieses Ticket ${c.key} wurde durch die Jira-Automatisierungsregel [${worker.name}|https://partner.bdr.de/jira/secure/AutomationProjectAdminAction!default.jspa?projectKey=CER#/rule/914] erstellt.`);
    assert.equal(c.sendNotifications,false);
    assert.equal(c.publicComment,false);
    assert.equal(s.all.find(i=>i.key===c.key).comments.length,1);
    assert.ok(s.emails[0].body.includes(`browse/${c.key}`));
  }
  assert.equal(s.emails.length,1);
});

test('single worker comments the created ticket rather than its trigger issue and keeps notifications',()=>{
  const original = {...issue('CER-99','CVE-2026-9999'),comments:['Existing comment']};
  const created = issue('CER-100','CVE-2026-1000');
  const result = runRule(worker,{issue:original,webhookData:{findingId:'CVE-2026-1000',library:'library',installedVersion:'1',severity:'HIGH',source:'https://example.org/job'}},{lookup:()=>[],create:()=>created});
  const comments = result.events.filter(e=>e.type==='comment');
  assert.equal(comments.length,1);
  assert.equal(comments[0].key,created.key);
  assert.equal(comments[0].sendNotifications,true);
  assert.ok(comments[0].body.includes(worker.name));
  assert.ok(comments[0].body.includes('#/rule/914'));
  assert.deepEqual(original.comments,['Existing comment']);
  assert.equal(created.comments.length,1);
  assert.equal(result.globals.issue,original);
});

test('native created-issue comments do not depend on JQL and addCommentOnce prevents repetition',()=>{
  const branch = structuredClone(flat(worker.components).find(c=>c.type==='jira.issue.related'));
  const created = issue('CER-100','CVE-2026-1000');
  const globals = {createdIssue:created};
  const handlers = {lookup:()=>[]};
  const jqlBranch = structuredClone(branch);
  jqlBranch.value.relatedType='jql'; jqlBranch.value.jql='key = {{createdIssue.key}}';
  assert.equal(runRule({name:worker.name,components:[jqlBranch]},globals,handlers).events.filter(e=>e.type==='comment').length,0);
  const result = runRule({name:worker.name,components:[branch,branch]},globals,handlers);
  assert.equal(result.events.filter(e=>e.type==='comment').length,1);
  assert.equal(created.comments.length,1);
});

test('report duplicate checks leave existing tickets and their comments unchanged',()=>{
  const original = {...issue('CER-1','CVE-2026-1000','Done'),comments:['Existing comment']};
  const s = scenario([finding('CVE-2026-1000')],[original]);
  assert.equal(s.created.length,0);
  assert.ok(!s.events.some(e=>e.type==='comment'));
  assert.deepEqual(original.comments,['Existing comment']);
});

const productionRecipients = [
  {type:'FREE',value:'"Kozlowski, Matthias (extern)" <Matthias.Kozlowski.extern@BDR.de>'},
  {type:'FREE',value:'"Kiepke, Gerald" <Gerald.Kiepke@BDR.de>'},
  {type:'FREE',value:'"Laska, Adrian" <Adrian.Laska@bdr.de>'},
  {type:'FREE',value:'"Kühl, Alexander" <Alexander.Kuehl@BDR.de>'},
];
const production = (findings,existing=[],options={}) => scenario(findings,existing,{...options,callerId:1029});

test('1029 filters HIGH/CRITICAL, checks first five unique suitable tuples and sends one production overview',()=>{
  const high = Array.from({length:7},(_,i)=>finding(`CVE-2026-${2000+i}`,i%2?'CRITICAL':'HIGH'));
  const s = production([finding('CVE-2026-1000','LOW'),high[0],high[0],finding('CVE-2026-1001','MEDIUM'),...high.slice(1)]);
  assert.equal(s.created.length,5); assert.equal(s.executions,5); assert.equal(s.emails.length,1);
  assert.deepEqual(s.events.filter(e=>e.type==='post').map(e=>[e.payload.mode,e.payload.originRuleId,e.payload.position]),Array.from({length:5},(_,i)=>['trivy-report-1029','1029',String(i)]));
  const mail=s.emails[0]; assert.deepEqual(mail.to,productionRecipients);assert.deepEqual(mail.cc,[]);assert.deepEqual(mail.bcc,[]);
  assert.match(mail.subject,/HIGH\/CRITICAL/);assert.match(mail.body,/ersten fünf/);assert.match(mail.body,/#\/rule\/1029/);assert.ok(mail.body.includes(productionAlert.name));
  assert.doesNotMatch(mail.body,/LOW|MEDIUM|aller Schweregrade|rule\/1062|@@TICKET:|Bereits vorhandene Tickets verhindern|möglicherweise unvollständig/);
  for(const c of s.created)assert.ok(mail.body.includes(`browse/${c.key}`));
  assert.equal((mail.body.match(/<tr>/g)??[]).length,7);
  assert.equal((mail.body.match(/<td[^>]*><\/td>/g)??[]).length,2);
  const comments=s.events.filter(e=>e.type==='comment');assert.equal(comments.length,5);
  assert.deepEqual(comments.map(c=>c.key),s.created.map(c=>c.key));
  assert.ok(comments.every(c=>!c.sendNotifications&&c.body.includes(worker.name)&&c.body.includes('#/rule/914')));
});

test('1029 ends correctly after each possible selected-list length, including the fifth position',()=>{
  for(let count=1;count<=5;count++) {
    const s=production(Array.from({length:count},(_,i)=>finding(`CVE-2026-${2100+i}`,'HIGH')),[],{indexLag:true});
    assert.equal(s.executions,count);assert.equal(s.created.length,count);assert.equal(s.emails.length,1);
    for(const c of s.created)assert.ok(s.emails[0].body.includes(`browse/${c.key}`));
    assert.equal(s.events.at(-1).type,'log');assert.match(s.events.at(-1).value,/abschließende Übersicht/);
  }
});

test('1029 existing tickets in every status consume selected slots without backfill and later rows retain links',()=>{
  const findings=Array.from({length:7},(_,i)=>finding(`CVE-2026-${2200+i}`,'HIGH'));
  const existing=[issue('CER-7',findings[6].VulnerabilityID,'Done'),issue('CER-6',findings[5].VulnerabilityID,'Closed'),issue('CER-2',findings[0].VulnerabilityID,'In Progress'),issue('CER-1',findings[0].VulnerabilityID,'Done')];
  const s=production(findings,existing);
  assert.equal(s.created.length,4);assert.equal(s.executions,5);assert.equal(s.emails.length,1);
  const mail=s.emails[0].body;
  for(const key of ['CER-1','CER-2','CER-6','CER-7'])assert.ok(mail.includes(`browse/${key}`));
  assert.ok(mail.indexOf('browse/CER-2')<mail.indexOf('browse/CER-1'));
  assert.match(mail,/\(Done\)/);assert.match(mail,/\(Closed\)/);
  assert.ok(s.created.every(c=>!c.fields.summary.includes('CVE-2026-2205')&&!c.fields.summary.includes('CVE-2026-2206')));
  assert.equal(s.events.filter(e=>e.type==='comment').length,4);
});

test('1029 repeated report creates no duplicates, comments or replacement tickets',()=>{
  const findings=Array.from({length:6},(_,i)=>finding(`CVE-2026-${2300+i}`,'CRITICAL'));
  const first=production(findings); const second=production(findings,first.all);
  assert.equal(second.created.length,0);assert.equal(second.emails.length,1);assert.equal(second.all.length,5);
  assert.ok(!second.events.some(e=>e.type==='comment'));
  for(const c of first.created)assert.ok(second.emails[0].body.includes(`browse/${c.key}`));
});

test('1029 carries fresh keys across five steps despite index lag and repeated identifiers in different libraries',()=>{
  const s=production([finding('CVE-2026-2400','HIGH','first'),finding('CVE-2026-2400','HIGH','second'),finding('CVE-2026-2401','CRITICAL'),finding('CVE-2026-2402','HIGH'),finding('CVE-2026-2403','HIGH'),finding('CVE-2026-2404','HIGH')],[],{indexLag:true});
  assert.equal(s.created.length,4);assert.equal(s.executions,5);assert.equal(s.emails.length,1);
  assert.equal((s.emails[0].body.match(/browse\/CER-9000/g)??[]).length,2);
  for(const c of s.created)assert.ok(s.emails[0].body.includes(`browse/${c.key}`));
});

test('1029 rejects malformed candidates before selection, preserves escaped rows and handles no eligible candidates',()=>{
  const s=production([finding('CVE-2026-2500','HIGH','invalid|library'),finding('OTHER-1','CRITICAL'),...Array.from({length:6},(_,i)=>finding(`CVE-2026-${2501+i}`,'HIGH',i===0?'R&D <package>':'library'))]);
  assert.equal(s.created.length,5);assert.match(s.emails[0].body,/R&amp;D &lt;package&gt;/);
  assert.ok(s.created.every(c=>!c.fields.summary.includes('CVE-2026-2500')&&!c.fields.summary.includes('CVE-2026-2506')));
  const noCandidates=production([finding('OTHER-1','HIGH')]);assert.equal(noCandidates.created.length,0);assert.equal(noCandidates.emails.length,1);assert.equal(noCandidates.executions,1);
  assert.match(noCandidates.emails[0].body,/<td[^>]*><\/td>/);assert.doesNotMatch(noCandidates.emails[0].body,/browse\/|@@TICKET:/);
});

test('1029 scan without HIGH/CRITICAL never starts the worker or sends a mail',()=>{
  for(const findings of [[],['UNKNOWN','LOW','MEDIUM'].map((severity,i)=>finding(`CVE-2026-${2600+i}`,severity))]) {
    const s=production(findings);assert.equal(s.executions,0);assert.equal(s.created.length,0);assert.equal(s.emails.length,0);
  }
});

test('1029 context accepts positions zero through four but rejects mismatched mode, origin and positions before side effects',()=>{
  const s=production(Array.from({length:5},(_,i)=>finding(`CVE-2026-${2700+i}`,'HIGH')));
  const first=s.events.find(e=>e.type==='post').payload;
  const invalid=[{mode:'trivy-report-1062'}, {originRuleId:'1062'}, ...['4','5','-1','01','',undefined].map(position=>({position})), {pipelineId:'bad'},{reportRows:''},{source:'https://example.org/job'},{findingRows:undefined},{findingRows:''},{findingRows:first.findingRows.slice(0,-2)},{findingId:'CVE-2026-9999'},{library:'different-library'}];
  for(const patch of invalid) {
    const result=runRule(worker,{webhookData:{...first,...patch}},{lookup:()=>{throw Error('Invalid production ingress searched');},create:()=>{throw Error('Invalid production ingress created');}});
    assert.ok(!result.events.some(e=>['lookup','create','comment','post','email'].includes(e.type)));
  }
});

test('914 independently filters severity in production reports and completes skipped findings without backfill',()=>{
  const first=production([finding('CVE-2026-2800','HIGH')]).events.find(e=>e.type==='post').payload;
  for(const severity of ['UNKNOWN','LOW','MEDIUM','HIGH','CRITICAL']) {
    const result=runRule(worker,{webhookData:selectedFields(first,{severity})},{lookup:()=>[],create:()=>issue('CER-1',first.findingId)});
    assert.equal(result.events.filter(e=>e.type==='create').length,['HIGH','CRITICAL'].includes(severity)?1:0);
    assert.equal(result.events.filter(e=>e.type==='email').length,1);
    if(['UNKNOWN','LOW','MEDIUM'].includes(severity)) assert.ok(!result.events.some(e=>['lookup','comment','commentBranch'].includes(e.type)));
  }
  const bad=runRule(worker,{webhookData:selectedFields(first,{library:'invalid|library'})},{lookup:()=>[],create:()=>{throw Error('Invalid selected finding created');}});
  assert.equal(bad.events.filter(e=>e.type==='create').length,0);assert.equal(bad.events.filter(e=>e.type==='email').length,1);
});

test('failed production handoff or damaged final table cannot send an incomplete overview',()=>{
  const s=production(Array.from({length:5},(_,i)=>finding(`CVE-2026-${2900+i}`,'HIGH')));
  const posts=s.events.filter(e=>e.type==='post');
  for(const {payload} of posts.slice(0,4)) {
    const result=runRule(worker,{webhookData:payload},{lookup:()=>[],create:()=>issue('CER-1',payload.findingId),post:()=>500});
    assert.equal(result.events.filter(e=>e.type==='post').length,1);assert.ok(!result.events.some(e=>e.type==='email'));
    assert.ok(!result.events.some(e=>e.type==='log'&&e.value.includes('per HTTP an den nächsten')));
  }
  const payload=posts.at(-1).payload;
  const damaged=runRule(worker,{webhookData:payload},{lookup:()=>[],create:()=>issue('CER-1',payload.findingId),variable:(name,value)=>name==='securityReportTable'?value.replace('</tbody></table>',''):value});
  assert.ok(!damaged.events.some(e=>e.type==='email'));
});

test('fresh lookup of an old ticket containing multiple identifiers preserves newest-first links and updates status',()=>{
  for(const callerId of [1062,1029]) {
    const first=finding('CVE-2026-4100','HIGH'), second=finding('CVE-2026-4101','HIGH');
    const newer=issue('CER-200',first.VulnerabilityID,'Open');
    const older=issue('CER-100',first.VulnerabilityID,'Done');older.description+=' '+second.VulnerabilityID;
    const s=scenario([first,second],[newer,older],{callerId});
    assert.equal(s.created.length,0);assert.equal(s.executions,2);assert.equal(s.emails.length,1);
    const rows=s.emails[0].body.match(/<tr>.*?<\/tr>/g);
    assert.ok(rows[0].indexOf('browse/CER-200')<rows[0].indexOf('browse/CER-100'));
    assert.equal((rows[0].match(/browse\/CER-100/g)??[]).length,1);
    assert.ok(rows[1].includes('browse/CER-100'));
  }
});

test('a zero-candidate report must start at zero and carry empty selected fields',()=>{
  for(const callerId of [1062,1029]) {
    const payload=scenario([finding('OTHER-1','HIGH')],[],{callerId}).events.find(e=>e.type==='post').payload;
    for(const patch of [{position:'1'},{findingId:'CVE-2026-9999'},{library:'unexpected'}]) {
      const result=runRule(worker,{webhookData:{...payload,...patch}},{lookup:()=>{throw Error('Bad empty report searched');},create:()=>{throw Error('Bad empty report created');}});
      assert.ok(!result.events.some(e=>['lookup','create','post','email'].includes(e.type)));
    }
  }
});
