// Bounded fixture interpreter for the exported Security templates/data flow.
// This does not replace verification in Jira Data Center's actual runtime.
import assert from 'node:assert/strict';
const text = v => v == null ? '' : Array.isArray(v) ? v.map(text).join(', ') : String(v);
const truth = v => Array.isArray(v) ? v.length > 0 : Boolean(v);
const escape = v => text(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const html = v => text(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function pattern(v, global = false) {
  let source = text(v).replace(/\\Q(.*?)\\E/g, (_, literal) => escape(literal));
  const multiline = source.startsWith('(?m)'), dotall = source.startsWith('(?s)'); if (multiline || dotall) source = source.substring(4);
  return new RegExp(source, `${global ? 'g' : ''}${multiline ? 'm' : ''}${dotall ? 's' : ''}`);
}
const functions = { equals: (a,b) => text(a) === text(b), exists: v => v != null && truth(v), not: a => !truth(a), and: (...a) => a.every(truth), or: (...a) => a.some(truth) };
function member(v, name, args) {
  // Inline collection text operations keep the outer context, unlike # sections.
  if(Array.isArray(v) && args !== undefined && !['get','join','asJsonObject'].includes(name)) return v.map(x=>member(x,name,args));
  const s = text(v);
  const methods = {
    concat: x => s+text(x), trim: () => s.trim(),
    // String.split uses a regex separator and removes trailing empty parts.
    split: x => { const parts = s.split(pattern(x)); if (s !== '') while (parts.at(-1) === '') parts.pop(); return parts; },
    get: i => { assert.ok(i !== undefined && Number.isInteger(Number(i)), 'Collection.get requires an explicit numeric index'); return v?.[Number(i)]; }, join: x => Array.isArray(v) ? v.join(text(x)) : s,
    asJsonObject: key => Array.isArray(v) ? v.map(x=>({[key]:text(x)})) : {[key]:s},
    // Data Center returns null, a single match text, or a collection of matches.
    match: x => { const matches = [...s.matchAll(pattern(x,true))].map(m => m[1]); return matches.length > 1 ? matches : matches[0] ?? null; }, replace: (a,b) => s.replaceAll(text(a),text(b)),
    replaceAll: (a,b) => s.replace(pattern(a,true),text(b)), startsWith: x => s.startsWith(text(x)),
    substring: (a,b) => s.substring(Number(a),b === undefined ? undefined : Number(b)),
    substringBefore: x => s.includes(text(x)) ? s.substring(0,s.indexOf(text(x))) : s,
    substringBeforeLast: x => s.includes(text(x)) ? s.substring(0,s.lastIndexOf(text(x))) : s,
    substringAfter: x => s.includes(text(x)) ? s.substring(s.indexOf(text(x))+text(x).length) : '',
    substringBetween: (a,b) => s.includes(text(a)) ? s.substring(s.indexOf(text(a))+text(a).length).split(text(b))[0] : '',
  };
  if (args !== undefined) { assert.ok(methods[name], `Unsupported fixture method ${name}`); return methods[name](...args); }
  const props = { trim: () => s.trim(), size: () => v?.length, distinct: () => Array.isArray(v) ? [...new Set(v)] : v, first: () => v?.[0], last: () => v?.at(-1), toUpperCase: () => s.toUpperCase(), htmlEncode: () => html(v), asJsonString: () => JSON.stringify(s), asJsonArray: () => JSON.stringify(v), quote: () => `\\Q${s}\\E` };
  return props[name] ? props[name]() : v?.[name];
}
export function evaluate(expression, globals, scopes = []) {
  let i = 0; const current = scopes.at(-1);
  const space = () => { while (i < expression.length && /\s/.test(expression[i])) i++; };
  // A # list section exposes its item and lower fields, not outer variables.
  const resolve = key => scopes.length ? (current && typeof current === 'object' ? current[key] : undefined) : globals[key];
  function name() { const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(expression.substring(i)); assert.ok(m, expression.substring(i)); i += m[0].length; return m[0]; }
  function args() { const out = []; i++; space(); if (expression[i] !== ')') do { out.push(value()); space(); if (expression[i] !== ',') break; i++; } while (true); assert.equal(expression[i++],')',expression); return out; }
  function value() {
    space(); let out;
    if (expression[i] === '"') { i++; out = ''; while (i < expression.length && expression[i] !== '"') { if (expression[i] === '\\' && ['"','\\'].includes(expression[i+1])) i++; out += expression[i++]; } assert.equal(expression[i++],'"'); }
    else if (/\d/.test(expression[i] ?? '')) { const n = /^\d+/.exec(expression.substring(i))[0]; i += n.length; out = Number(n); }
    else if (expression[i] === '.') { i++; assert.ok(!/[A-Za-z_]/.test(expression[i] ?? ''),'Primitive member access after a leading dot is unsupported in Data Center'); out = current; }
    else { const key = name(); space(); out = expression[i] === '(' ? functions[key] ? functions[key](...args()) : member(current,key,args()) : resolve(key); }
    while (true) { space(); if (expression[i] !== '.') break; i++; const key = name(); space(); out = member(out,key,expression[i] === '(' ? args() : undefined); }
    space(); if (expression[i] === '|') { i++; const fallback = value(); if (!truth(out)) out = fallback; }
    return out;
  }
  const out = value(); space(); assert.equal(i,expression.length,expression); return out;
}
export function render(template, globals, scopes = []) {
  const tokens = template.split(/(\{\{.*?\}\})/s).filter(Boolean); let i = 0;
  function parse(nested = false) {
    const nodes = [];
    while (i < tokens.length) { const t = tokens[i++]; if (t === '{{/}}') { assert.ok(nested); return nodes; }
      if (t.startsWith('{{#') || t.startsWith('{{^')) nodes.push({ expr: t.substring(3,t.length-2), inverse: t[2] === '^', children: parse(true) }); else nodes.push(t);
    } assert.equal(nested,false,'Unclosed section'); return nodes;
  }
  function output(nodes, context, index) { return nodes.map(n => {
    // Data Center does not provide an implicit index for a template section.
    const scopedGlobals = globals;
    if (typeof n === 'string') return n.startsWith('{{') ? text(evaluate(n.substring(2,n.length-2),scopedGlobals,context)) : n;
    if (n.expr === '=') {
      const expression = output(n.children,context,index).trim();
      assert.match(expression,/^\d+\s*[+-]\s*\d+$/,'Fixture supports only the required two-operand integer expression');
      const [,a,operator,b] = expression.match(/^(\d+)\s*([+-])\s*(\d+)$/);
      return String(operator === '+' ? Number(a)+Number(b) : Number(a)-Number(b));
    }
    const conditional = n.expr.startsWith('if('), v = evaluate(conditional ? n.expr.substring(3,n.expr.length-1) : n.expr,scopedGlobals,context);
    if (conditional) assert.equal(typeof v,'boolean','Use an explicit boolean for conditional Smart Values');
    if (n.inverse) return !truth(v) ? output(n.children,context,index) : ''; if (!truth(v)) return '';
    return conditional ? output(n.children,context,index) : Array.isArray(v) ? v.map((x,i) => output(n.children,[...context,x],i)).join('') : output(n.children,[...context,v],index);
  }).join(''); }
  return output(parse(),scopes);
}
export function runRule(rule, globals, handlers = {}) {
  const events = [];
  const check = c => { const a = render(c.value.first,globals), b = render(c.value.second,globals); switch (c.value.operator) {
    case 'EQUALS': return a === b; case 'NOT_EQUALS': return a !== b; case 'GREATER_THAN': return a !== '' && Number(a) > Number(b); case 'NOT_CONTAINS': return !a.includes(b);
    case 'REGEX_MATCHES': return pattern(`^(?:${b})$`).test(a); case 'REGEX_NOT_MATCHES': return !pattern(`^(?:${b})$`).test(a);
    default: throw new Error(`Unsupported fixture comparator ${c.value.operator}`);
  }};
  function walk(cs) { for (const c of cs) switch (c.type) {
    case 'jira.comparator.condition': if (!check(c)) return false; break;
    case 'jira.condition.container.block': walk(c.children); break;
    case 'jira.condition.if.block': {
      const checks = c.conditions.map(check);
      if (c.value.conditionMatchType === 'ANY' ? checks.some(Boolean) : checks.every(Boolean)) {
        // A created issue belongs to the conditional path that created it.
        // Keep lookup results and declared variable updates, as observed in the
        // live rules; the separate declaration audit checks own variable scope.
        const hadCreatedIssue = Object.hasOwn(globals,'createdIssue');
        const previousCreatedIssue = globals.createdIssue;
        walk(c.children);
        if (hadCreatedIssue) globals.createdIssue = previousCreatedIssue;
        else delete globals.createdIssue;
      }
      break;
    }
    case 'jira.create.variable': { const name = c.value.name.value, value = render(c.value.query.value,globals); globals[name] = handlers.variable ? handlers.variable(name,value) : value; break; }
    case 'jira.lookup.issues': { const query = render(c.value.query.value,globals); events.push({type:'lookup',query}); globals.lookupIssues = handlers.lookup(query); break; }
    case 'jira.issue.create': { const fields = Object.fromEntries(c.value.operations.map(op => [op.fieldId,typeof op.value === 'string' ? render(op.value,globals) : op.value])); globals.createdIssue = handlers.create(fields); events.push({type:'create',fields,key:globals.createdIssue.key}); break; }
    case 'jira.issue.outgoing.webhook': if (c.value.method === 'POST') { events.push({type:'post',payload:JSON.parse(render(c.value.customBody,globals))}); globals.webhookResponse = {status:202,body:{}}; } else globals.webhookResponse = {status:200,body:handlers.get()}; break;
    case 'jira.issue.outgoing.email': events.push({type:'email',subject:render(c.value.subject,globals),body:render(c.value.body,globals),to:c.value.to,cc:c.value.cc,bcc:c.value.bcc}); break;
    case 'jira.issue.related': events.push({type:'commentBranch',notifications:c.children.map(x => x.value.sendNotifications)}); break;
    case 'codebarrel.action.log': events.push({type:'log',value:render(c.value,globals)}); break;
    default: throw new Error(`Unsupported fixture component ${c.type}`);
  } return true; }
  walk(rule.components); return {events,globals};
}
