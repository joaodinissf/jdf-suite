export const meta = {
  name: 'huddle-audit',
  description: 'Full audit of packages/jdf-tab-huddle: map, back end, front end, tests, adversarial verification, Codex second opinion, report',
  whenToUse: 'A thorough, evidence-backed audit of the Huddle Chrome extension. Run in three stages (args.stage) so each fits a usage window; stages hand over through files in args.out.',
  phases: [
    { title: 'Map', detail: 'audit-context-building: per-file trust boundaries, message contracts, storage' },
    { title: 'Back end', detail: 'correctness, MV3 lifecycle, security, privacy, insecure defaults, sharp edges, Semgrep, supply chain' },
    { title: 'Front end', detail: 'Impeccable audit + critique, detector, browser-driven a11y/keyboard/contrast, light and dark' },
    { title: 'Tests', detail: 'tests that cannot fail, Stryker mutation testing on core logic' },
    { title: 'Verify', detail: 'fp-check style refutation, reproduction, variant analysis' },
    { title: 'Second opinion', detail: 'Codex reviews the confirmed findings' },
    { title: 'Report', detail: 'numbered findings by severity and a fix plan' },
  ],
}

// Usage (run the stages in order; each reads the previous stage's files):
//   Workflow({ name: 'huddle-audit', args: { stage: 'map-backend',    out: '/abs/dir' } })
//   Workflow({ name: 'huddle-audit', args: { stage: 'frontend-tests', out: '/abs/dir' } })
//   Workflow({ name: 'huddle-audit', args: { stage: 'verify-report',  out: '/abs/dir' } })
// args.out: an absolute directory outside the repo for this run's files.
// args.repo (optional): the jdf-suite checkout; defaults to the path below.
// args.tools (optional): { semgrep, impeccable, stryker } booleans, default all true.

const A = args || {}
const STAGE = A.stage
const OUT = A.out
const REPO = A.repo || '/Users/joao/Git/jdf/jdf-suite'
const PKG = `${REPO}/packages/jdf-tab-huddle`
const TOOLS = { semgrep: true, impeccable: true, stryker: true, ...(A.tools || {}) }
if (!['map-backend', 'frontend-tests', 'verify-report'].includes(STAGE) || !OUT) {
  throw new Error("args: { stage: 'map-backend' | 'frontend-tests' | 'verify-report', out: '/absolute/dir' } required")
}

// Third-party method files, read live from GitHub at a pinned commit (never installed).
const TOB = 'https://github.com/trailofbits/skills/blob/82fe8226252622fa807643bdca1710901198553a/plugins'
const IMP = 'https://github.com/pbakaus/impeccable/blob/114ea1d3838fca73b253af45f873b9c4f5f213c8/.claude/skills/impeccable'
const SKILL = {
  context: `${TOB}/audit-context-building/skills/audit-context-building/SKILL.md`,
  entry: `${TOB}/entry-point-analyzer/skills/entry-point-analyzer/SKILL.md`,
  insecure: `${TOB}/insecure-defaults/README.md`,
  sharp: `${TOB}/sharp-edges/skills/sharp-edges/SKILL.md`,
  semgrep: `${TOB}/static-analysis/skills/semgrep/SKILL.md`,
  supply: `${TOB}/supply-chain-risk-auditor/skills/supply-chain-risk-auditor/SKILL.md`,
  mutation: `${TOB}/mutation-testing/skills/mutation-testing/SKILL.md`,
  fp: `${TOB}/fp-check/skills/fp-check/SKILL.md`,
  variant: `${TOB}/variant-analysis/skills/variant-analysis/SKILL.md`,
  impeccable: `${IMP}/SKILL.md`,
  impAudit: `${IMP}/reference/audit.md`,
  impCritique: `${IMP}/reference/critique.md`,
  mv3: 'https://developer.chrome.com/docs/extensions/develop/migrate/checklist',
}

const BASE = `You are auditing "Huddle", a Chrome Manifest V3 tab-management extension, at ${PKG} (source in src/, unit tests in tests/ (Vitest), e2e in e2e/ (Playwright, with e2e/helpers/fake-openrouter.js faking OpenRouter), design rules in DESIGN.md, product facts in PRODUCT.md). Scope is this package only.
Rules:
- Read-only on the repo: never edit, commit, push, run gh write commands, or change git state in ${REPO}. Scratch work goes under ${OUT}.
- Methods from third-party skills are read by reference: fetch the linked file (gh api or WebFetch on the raw URL) and follow its method. Never install a skill or plugin.
- Never use the user's own Chrome or profile. Browser work uses Chrome for Testing via Playwright (see e2e/fixtures/extension.js for flags; set PW_EXECUTABLE to a Chrome for Testing binary under ~/Library/Caches/ms-playwright) with throwaway profiles and OpenRouter faked; never send a real API key anywhere.
- Every finding needs evidence: file:line, and for behaviour, a reproduction (a command, test or browser script under ${OUT}) and what it showed. No speculation, no style nits.`

const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: {
  title: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
  area: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer' },
  evidence: { type: 'string' }, repro: { type: 'string' }, impact: { type: 'string' }, fix: { type: 'string' } },
  required: ['title', 'severity', 'area', 'file', 'line', 'evidence', 'repro', 'impact', 'fix'] } } }, required: ['findings'] }
const VOTE = { type: 'object', properties: { refuted: { type: 'boolean' }, reasoning: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } }, required: ['refuted', 'reasoning', 'severity'] }

const save = (file, what) => `Write ${what} as JSON to ${OUT}/${file} (create ${OUT} if needed) and also return it.`
const run = (label, phaseName, prompt, schema) => agent(`${BASE}\n\n${prompt}`, { label, phase: phaseName, schema })
const collect = (results) => results.filter(Boolean).flatMap((r) => r.findings || [])

if (STAGE === 'map-backend') {
  phase('Map')
  const map = await run('map', 'Map', `Build the audit context first, following ${SKILL.context} and ${SKILL.entry}. For every file in src/: its role, entry points (chrome.runtime.onMessage actions, ports, alarms, commands, content-script events, page handlers), trust boundaries (web pages, extension pages, OpenRouter, storage), data it stores (chrome.storage local/sync/session keys) and the message contracts between pages and background.js. Include manifest.json permissions and what uses each one. ${save('map.json', 'the map')}`)
  log('Context map written')

  phase('Back end')
  const DIMS = [
    { key: 'correctness', p: `Correctness of background.js, content-clumper.js and the page scripts: logic bugs, races between async Chrome calls, error paths that are swallowed or mis-reported, state that goes stale.` },
    { key: 'lifecycle', p: `Manifest V3 lifecycle: the service worker being stopped at any await (in-memory state lost, pending promises, ports, alarms), storage consistency across restarts, extension update/reload, multiple windows and tabs.` },
    { key: 'security', p: `Security. Use ${SKILL.mv3} and the MV3 security basics: least-privilege permissions and host access (is each permission, including <all_urls> content scripts, needed?), message sender validation, any path from web content or model output to innerHTML or URLs, CSP and remote code, API key handling (it is stored base64-encoded, which is not encryption; judge the real risk), network calls.` },
    { key: 'privacy', p: `Privacy: what leaves the device (tab titles and URLs to OpenRouter; anything else), whether the user is told before it happens, what is logged to the console, and what chrome.storage.sync spreads across devices.` },
    { key: 'defaults', p: `Fail-open insecure defaults, following ${SKILL.insecure}, and error-prone APIs and footguns, following ${SKILL.sharp}.` },
    { key: 'ai-client', p: `The OpenRouter client and model catalog: request building per model capability, streaming, timeouts, retries and fallbacks, error mapping, catalog caching and filtering, curated models against the live catalog (GET https://openrouter.ai/api/v1/models needs no key).` },
    ...(TOOLS.semgrep ? [{ key: 'semgrep', p: `Static analysis with Semgrep, following ${SKILL.semgrep}: run it through npx or pipx without adding it to the project (for example: npx --yes semgrep or uvx semgrep) with the p/javascript, p/xss and p/secrets rulesets and any browser-extension rules you find, over src/. Triage every hit against the code; report only real ones.` }] : []),
    { key: 'supply-chain', p: `Supply chain, following ${SKILL.supply}: package.json and pnpm-lock.yaml dev dependencies, pnpm-workspace.yaml overrides, what ships in the zip (the release workflow zips src/), and CI workflows in ${REPO}/.github/workflows/jdf-tab-huddle-*.yml.` },
  ]
  const found = await parallel(DIMS.map((d) => () => run(`backend:${d.key}`, 'Back end', `Context map: ${OUT}/map.json.\nDimension: ${d.p}\nReport every real defect. ${save(`backend-${d.key}.json`, 'your findings')}`, FINDINGS)))
  const all = collect(found)
  log(`${all.length} back-end findings; stage 1 done. Next: stage 'frontend-tests'.`)
  return { stage: STAGE, findings: all.length, out: OUT }
}

if (STAGE === 'frontend-tests') {
  phase('Front end')
  const PAGES = ['popup', 'organize (ai-proposal)', 'settings (options, including its AI section)', 'nap room', 'confirmation dialog']
  const fe = [
    ...PAGES.map((pg) => () => run(`frontend:${pg.split(' ')[0]}`, 'Front end', `Page: ${pg}. Follow Impeccable's method by reference (${SKILL.impeccable}, ${SKILL.impAudit}, ${SKILL.impCritique}) against DESIGN.md and PRODUCT.md. Drive the real page in Chrome for Testing (light and dark via emulated prefers-color-scheme), screenshot every state you can reach (empty, busy, errors, long content, narrow width), and check keyboard-only use, focus order and visibility, screen-reader names and live regions, and WCAG AA contrast measured on the rendered page. Save scripts and screenshots under ${OUT}/frontend/. ${save(`frontend-${pg.split(' ')[0]}.json`, 'your findings')}`, FINDINGS)),
    ...(TOOLS.impeccable ? [() => run('frontend:detector', 'Front end', `Run Impeccable's deterministic detector without adding it to the project: npx --yes impeccable detect --json ${PKG}/src (see ${SKILL.impeccable}). Triage every hit against DESIGN.md; report only real problems, with the rule id. ${save('frontend-detector.json', 'your findings')}`, FINDINGS)] : []),
  ]

  phase('Tests')
  const tests = [
    () => run('tests:discrimination', 'Tests', `Find tests that cannot fail or do not test what they claim: assertions that pass whatever the code does, mocks that hide the behaviour under test (for example a chrome.tabs.query mock that matches any URL), e2e checks that pass before the action runs. For each suspect, prove it by breaking the code on a scratch copy under ${OUT} (never in the repo) and showing the test still passes. ${save('tests-discrimination.json', 'your findings')}`, FINDINGS),
    ...(TOOLS.stryker ? [() => run('tests:mutation', 'Tests', `Mutation testing, following ${SKILL.mutation}: copy the package to ${OUT}/mutation/ (not the repo), run Stryker there through npx without adding it to the project, targeting the core logic (background.js message handlers, sorting, dedup, snooze, the AI client; ai-config.js), with the Vitest runner. Report surviving mutants that matter: each is a behaviour no test pins down. Group by function. ${save('tests-mutation.json', 'your findings')}`, FINDINGS)] : []),
  ]
  const found = await parallel([...fe, ...tests])
  const all = collect(found)
  log(`${all.length} front-end and test findings; stage 2 done. Next: stage 'verify-report'.`)
  return { stage: STAGE, findings: all.length, out: OUT }
}

// STAGE === 'verify-report'
phase('Verify')
const gathered = await run('gather', 'Verify', `Read every findings file in ${OUT} (backend-*.json, frontend-*.json, tests-*.json). Merge duplicates (same root cause) into one finding that keeps the strongest evidence; drop nothing else. ${save('merged.json', 'the merged findings')}`, FINDINGS)
const merged = (gathered && gathered.findings) || []
log(`${merged.length} findings after merging duplicates`)

const verified = await parallel(merged.map((f, i) => () =>
  parallel([0, 1, 2].map((k) => () => run(`verify:${i + 1}:${k + 1}`, 'Verify',
    `Follow ${SKILL.fp}. Try hard to REFUTE this finding: re-read the real code paths and re-run or rebuild its reproduction under ${OUT}/verify/. ${k === 2 ? 'Take the attacker or hostile-user view: can it actually be triggered, and what is the real impact?' : k === 1 ? 'Check whether it is intended behaviour documented in DESIGN.md, PRODUCT.md or README.md.' : 'Check the reproduction itself: does it show what is claimed?'} If you cannot refute it after reading, refuted=false, with a calibrated severity.\nFINDING:\n${JSON.stringify(f, null, 2)}`, VOTE)))
    .then((votes) => {
      const v = votes.filter(Boolean)
      const upheld = v.filter((x) => !x.refuted)
      return upheld.length >= 2 ? { ...f, severity: upheld[0].severity, votes: v.map((x) => x.reasoning) } : null
    })))
const confirmed = verified.filter(Boolean)
log(`${confirmed.length} of ${merged.length} findings survived refutation`)

const variants = await parallel(confirmed.filter((f) => ['critical', 'high'].includes(f.severity)).map((f, i) => () =>
  run(`variants:${i + 1}`, 'Verify', `Follow ${SKILL.variant}. This confirmed bug may have siblings elsewhere in ${PKG}/src: find them, with evidence, and do not repeat the original.\nORIGINAL:\n${JSON.stringify(f, null, 2)}`, FINDINGS)))
const extra = collect(variants)
if (extra.length) log(`${extra.length} variants found (reported separately, not yet refutation-checked)`)

phase('Second opinion')
const second = await agent(`${BASE}\n\nYou are a second reviewer from a different model family. Review these confirmed findings for Huddle: for each, say agree / disagree / severity change, with a reason from the code. Then name up to 5 serious problems in ${PKG}/src that the list misses, with file:line evidence.\nCONFIRMED:\n${JSON.stringify(confirmed.map((f) => ({ title: f.title, severity: f.severity, file: f.file, line: f.line, evidence: f.evidence })), null, 2)}`,
  { label: 'codex', phase: 'Second opinion', agentType: 'codex:codex-rescue' })

phase('Report')
const report = await run('report', 'Report', `Write the audit report as Markdown to ${OUT}/report.md: a summary, then every confirmed finding numbered by severity (title, file:line, evidence, reproduction, impact, fix), then the variant findings marked as unverified, then the second opinion's agreements, disagreements and additions, then a fix plan that groups findings into small PRs in a sensible order. Keep it plain and precise.\nCONFIRMED:\n${JSON.stringify(confirmed)}\nVARIANTS:\n${JSON.stringify(extra)}\nSECOND OPINION:\n${second}`)
return { stage: STAGE, merged: merged.length, confirmed: confirmed.length, variants: extra.length, report: `${OUT}/report.md`, summary: report }
