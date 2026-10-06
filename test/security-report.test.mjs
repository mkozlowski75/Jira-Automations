import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { render, runRule } from './helpers/security-automation-fixture.mjs';
const rule = id => JSON.parse(readFileSync(new URL(`../../jira-automation-rules/rules/CER-jira-rule-${id}.json`,import.meta.url),'utf8'));
const alert = rule(1062), worker = rule(914);
const flat = cs => cs.flatMap(c => [c,...flat(c.children ?? []),...flat(c.conditions ?? [])]);
const finding = (id,severity='LOW',library='library') => ({VulnerabilityID:id,Severity:severity,PkgName:library,InstalledVersion:'1.0'});
const issue = (key,id,status='Open') => ({key,summary:`[CVE] ${id} – library`,description:`Finding ${id}`,status:{name:status}});
function scenario(findings, existing = [], { indexLag = false, statusChange = false, lookupLimit = 100 } = {}) {
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
  const start = runRule(alert,{},handlers); events.push(...start.events); posts.push(...start.events.filter(e=>e.type==='post').map(e=>e.payload));
  let executions = 0;
  while (posts.length) {
    assert.ok(++executions <= 2,'Chain must stop after at most two worker invocations');
    const result = runRule(worker,{webhookData:posts.shift()},handlers);
    events.push(...result.events); posts.push(...result.events.filter(e=>e.type==='post').map(e=>e.payload));
  }
  return {events,all,executions,emails:events.filter(e=>e.type==='email'),created:events.filter(e=>e.type==='create')};
}
test('1062 processes every severity but only first two eligible tuples; summary includes immediate keys',()=>{
  const s = scenario(['UNKNOWN','LOW','MEDIUM','HIGH','CRITICAL'].map((severity,i)=>finding(`CVE-2026-${1000+i}`,severity)));
  assert.equal(s.created.length,2); assert.equal(s.executions,2); assert.equal(s.emails.length,1);
  const mail = s.emails[0]; assert.deepEqual(mail.to,[{type:'FREE',value:'matthias.kozlowski.extern@bdr.de'}]); assert.deepEqual(mail.cc,[]); assert.deepEqual(mail.bcc,[]);
  assert.match(mail.body,/>Jira-Tickets</); assert.doesNotMatch(mail.body,/@ @|@@TICKET:/);
  for (const c of s.created) assert.match(mail.body,new RegExp(`browse/${c.key}`));
  for (const severity of ['UNKNOWN','LOW','MEDIUM','HIGH','CRITICAL']) assert.ok(mail.body.includes(severity));
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
  const s = scenario([finding('CVE-2026-1000','LOW','library-a'),finding('CVE-2026-1000','MEDIUM','library-b')],[],{indexLag:true});
  assert.equal(s.created.length,1); assert.equal(s.emails.length,1);
  assert.equal((s.emails[0].body.match(/browse\/CER-9000/g)??[]).length,2);
});
test('report with no eligible identifiers still sends overview with empty ticket cells',()=>{
  const s = scenario([finding('OTHER-123','LOW')]); assert.equal(s.created.length,0); assert.equal(s.emails.length,1); assert.equal(s.executions,1);
  assert.doesNotMatch(s.emails[0].body,/browse\/|@@TICKET:/); assert.match(s.emails[0].body,/<td[^>]*><\/td>/);
});
test('empty scan sends no overview and starts no worker',()=>{ const s = scenario([]); assert.equal(s.emails.length,0); assert.equal(s.executions,0); });
test('100 returned ticket matches make incomplete lookup explicit',()=>{
  const s = scenario([finding('CVE-2026-1000')],Array.from({length:100},(_,i)=>issue(`CER-${i}`,'CVE-2026-1000')));
  assert.match(s.emails[0].body,/möglicherweise unvollständig/);
});
test('fresh ticket status replaces the initial status without duplicate links',()=>{
  const s = scenario([finding('CVE-2026-1000')],[issue('CER-1','CVE-2026-1000','Open')],{statusChange:true});
  assert.equal((s.emails[0].body.match(/browse\/CER-1"/g)??[]).length,1);
  assert.match(s.emails[0].body,/\(Done\)/); assert.doesNotMatch(s.emails[0].body,/\(Open\)/);
});
test('unknown configurable lookup limit does not imply completeness even when below 100',()=>{
  const s = scenario([finding('CVE-2026-1000')],Array.from({length:60},(_,i)=>issue(`CER-${i}`,'CVE-2026-1000')),{lookupLimit:50});
  assert.match(s.emails[0].body,/möglicherweise unvollständig/);
});
test('mapping matches whole identifiers only and escapes issue status HTML',()=>{
  const s = scenario([finding('CVE-2026-1000')],[issue('CER-12','CVE-2026-10001','<Done>')]);
  assert.equal(s.created.length,1,'A prefix match must not suppress a different identifier');
  assert.doesNotMatch(s.emails[0].body,/browse\/CER-12/);
  const escaped = scenario([finding('CVE-2026-1000')],[issue('CER-12','CVE-2026-1000','<Done>')]);
  assert.match(escaped.emails[0].body,/\(&lt;Done&gt;\)/);
});
test('single-finding worker accepts all valid severities and keeps production recipients',()=>{
  const payload = {findingId:'CVE-2026-1000',library:'library',installedVersion:'1',severity:'LOW',source:'https://example.org/job'};
  const handlers = {lookup:()=>[],create:()=>issue('CER-1',payload.findingId)};
  for (const severity of ['UNKNOWN','LOW','MEDIUM','HIGH','CRITICAL']) {
    const result = runRule(worker,{webhookData:{...payload,severity}},handlers);
    assert.equal(result.events.filter(e=>e.type==='create').length,1);
    assert.equal(result.events.find(e=>e.type==='email').to.length,4);
    assert.doesNotMatch(result.events.find(e=>e.type==='lookup').query,/statusCategory/);
    assert.deepEqual(result.events.find(e=>e.type==='commentBranch').notifications,[true]);
  }
});
test('single-finding worker prevents recreation for every ticket status and matches whole identifiers',()=>{
  const payload = {findingId:'CVE-2026-1000',library:'library',installedVersion:'1',severity:'LOW',source:'https://example.org/job'};
  for (const status of ['Open','In Progress','Done','Closed']) {
    const result = runRule(worker,{webhookData:payload},{
      lookup:()=>[issue('CER-1',payload.findingId,status)],
      create:()=>{throw new Error(`Existing ${status} ticket must prevent creation`);},
    });
    assert.ok(!result.events.some(e=>['create','commentBranch','email'].includes(e.type)));
    assert.ok(result.events.some(e=>e.type==='log' && e.value.includes('Status unabhängig')));
  }
  const differentId = runRule(worker,{webhookData:payload},{
    lookup:()=>[issue('CER-2','CVE-2026-10001','Done')],
    create:()=>issue('CER-3',payload.findingId),
  });
  assert.equal(differentId.events.filter(e=>e.type==='create').length,1);
});
test('both worker modes accept valid severities and reject missing or invalid severities',()=>{
  const first = scenario([finding('CVE-2026-1000')]).events.find(e=>e.type==='post').payload;
  const single = {findingId:first.findingId,library:first.library,installedVersion:first.installedVersion,source:first.source};
  const handlers = {lookup:()=>[],create:()=>issue('CER-1',first.findingId)};
  for (const payload of [single,first]) {
    for (const severity of ['UNKNOWN','LOW','MEDIUM','HIGH','CRITICAL']) {
      const result = runRule(worker,{webhookData:{...payload,severity}},handlers);
      assert.equal(result.events.filter(e=>e.type==='create').length,1);
      assert.match(result.events.find(e=>e.type==='create').fields.description,new RegExp(`\\|\\*Schweregrad des Herstellers\\*\\|${severity}\\|`));
    }
    for (const severity of [undefined,'','low','IMPORTANT','HIGH|LOW']) {
      const result = runRule(worker,{webhookData:{...payload,severity}},handlers);
      assert.ok(!result.events.some(e=>['lookup','create','commentBranch'].includes(e.type)));
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
  const bad = {...first,library:'invalid|library'};
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
  const encoded = finding('CVE-2026-1003','MEDIUM','R&D <package>');
  const s = scenario([bad,finding('CVE-2026-1001'),encoded,finding('CVE-2026-1004')]);
  assert.equal(s.created.length,2);
  assert.ok(s.created.every(x=>!x.fields.summary.includes('CVE-2026-1000')&&!x.fields.summary.includes('CVE-2026-1004')));
  assert.match(s.emails[0].body,/R&amp;D &lt;package&gt;/);
});
test('all own variables are declared before use within their available scope',()=>{
  for (const r of [alert,worker]) {
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
test('the eleven findings from the failed Jira run produce two selected candidates and eleven complete rows',()=>{
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
  assert.equal(posts.length,2);
  assert.deepEqual(posts.map(e=>[e.payload.findingId,e.payload.library,e.payload.installedVersion,e.payload.severity]),[
    ['CVE-2025-15022','com.vaadin:vaadin-server','8.14.3','MEDIUM'],
    ['CVE-2025-9467','com.vaadin:vaadin-server','8.14.3','MEDIUM'],
  ]);
  assert.equal(s.created.length,2); assert.equal(s.emails.length,1);
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
  assert.throws(()=>render('{{#rows}}{{.substringBefore("@@")}}{{/}}',{rows:['row@@']}),/Primitive member access/);
  assert.throws(()=>render('{{#if(value.match("(CVE-2025-15022)"))}}yes{{/}}',{value:'CVE-2025-15022'}),/explicit boolean/);
  assert.equal(render('{{#if(exists(value.match("(CVE-2025-15022)")))}}yes{{/}}',{value:'CVE-2025-15022'}),'yes');
  assert.equal(render('{{#rows}}{{rows.get(index).substringBefore("@@")}}{{/}}',{rows:['first@@','second@@']}),'firstsecond');
  assert.equal(render('{{value.split("\\n").size}}',{value:'first\nsecond\n'}),'2');
});
test('HTTP acceptance conditions are followed by a real action in both rules',()=>{
  for (const r of [alert,worker]) for (const c of flat(r.components).filter(c=>c.type==='jira.condition.if.block')) {
    assert.notEqual(c.children.at(-1)?.type,'jira.comparator.condition',`${r.id}/${c.id}: terminal condition has no action`);
  }
});
