Fix all captain-obvious lint violations listed below.

For each file, edit it in place so every listed rule passes. Keep each change minimal and behavior-preserving. Do not disable, ignore, or delete rules to silence a violation.
When done, re-run `captain-obvious-lint` to confirm the violations are gone.

## /Users/ryan/Projects/captain-obvious/.worktrees/panel/hooks/git/__tests__/test-helpers.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 16:14 [unused export `GIT_TEST_ENV`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/core/hooks/claude/protected-paths-guard.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 1:1 [unused file] no other module imports this file. Delete it, or add its entrypoint to knip.json if it is reached dynamically.

## /Users/ryan/Projects/captain-obvious/core/hooks/git/dispatch.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 1:1 [unused file] no other module imports this file. Delete it, or add its entrypoint to knip.json if it is reached dynamically.

## /Users/ryan/Projects/captain-obvious/core/lib/__tests__/config.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 46:1 [clone cluster (31 nodes)] core/lib/__tests__/config.test.mjs:46-50 <-> core/lib/__tests__/json-file.test.mjs:39-43

## /Users/ryan/Projects/captain-obvious/core/src/db/__tests__/audit.test.ts

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 140:1 [clone cluster (24 nodes)] core/src/db/__tests__/audit.test.ts:140-143 <-> core/src/server/__tests__/registry.test.ts:233-236
- line 155:1 [clone cluster (21 nodes)] core/src/db/__tests__/audit.test.ts:155-158 <-> core/src/db/__tests__/open.test.ts:30-33

## /Users/ryan/Projects/captain-obvious/core/src/db/__tests__/languages.test.ts

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 34:1 [clone cluster (33 nodes)] core/src/db/__tests__/languages.test.ts:34-39 <-> core/src/db/__tests__/rules.test.ts:108-113
- line 41:1 [clone cluster (22 nodes)] core/src/db/__tests__/languages.test.ts:41-43 <-> core/src/db/__tests__/rules.test.ts:115-117
- line 45:1 [clone cluster (28 nodes)] core/src/db/__tests__/languages.test.ts:45-52 <-> core/src/db/__tests__/rules.test.ts:139-146

## /Users/ryan/Projects/captain-obvious/core/src/db/__tests__/rules.test.ts

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 237:1 [duplicate code (8 lines)] duplicates core/src/db/__tests__/rules.test.ts:219-226. Extract a shared helper instead of copying.
- line 250:1 [duplicate code (8 lines)] duplicates core/src/db/__tests__/rules.test.ts:219-244. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 35:1 [clone cluster (35 nodes)] core/src/db/__tests__/rules.test.ts:35-43 <-> core/src/db/__tests__/rules.test.ts:53-61
- line 167:1 [clone cluster (47 nodes)] core/src/db/__tests__/rules.test.ts:167-172 <-> core/src/db/__tests__/rules.test.ts:174-179

## /Users/ryan/Projects/captain-obvious/core/src/db/__tests__/seed.test.ts

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 128:1 [clone cluster (20 nodes)] core/src/db/__tests__/seed.test.ts:128-131 <-> core/src/rules/__tests__/fixtures/plugins-ok/good-rule/plugin.mjs:15-18 <-> core/src/rules/__tests__/load.test.ts:36-39 <-> core/src/server/__tests__/registry.test.ts:368-371

## /Users/ryan/Projects/captain-obvious/core/src/db/audit.ts

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 146:1 [duplicate code (8 lines)] duplicates core/src/db/audit.ts:100-107. Extract a shared helper instead of copying.

Rule Duplicate functions (lint-dup-fn):
Rule intent: Detects duplicated function bodies (AST clones) in production code.
Violations:
- line 25:1 [duplicate function body (2 sites, 72 nodes, cross-file)] identical α-normalized body: core/src/db/audit.ts:25 resolveAuditDbPath ↔ core/src/db/open.ts:41 resolveDbPath. same body reinvented across files — extract a shared helper.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 25:1 [clone cluster (72 nodes)] core/src/db/audit.ts:25-32 <-> core/src/db/open.ts:41-48

## /Users/ryan/Projects/captain-obvious/core/src/db/fixes.ts

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 91:1 [clone cluster (60 nodes)] core/src/db/fixes.ts:91-96 <-> core/src/server/registry.ts:207-212

## /Users/ryan/Projects/captain-obvious/core/src/db/lookups.ts

Rule Duplicate functions (lint-dup-fn):
Rule intent: Detects duplicated function bodies (AST clones) in production code.
Violations:
- line 15:1 [duplicate function body (3 sites, 36 nodes, same-file)] identical α-normalized body: core/src/db/lookups.ts:15 requireLanguageId ↔ core/src/db/lookups.ts:21 requireActionTypeId ↔ core/src/db/lookups.ts:27 requireEnvironmentId. same body under different names — collapse to one.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 15:1 [clone cluster (36 nodes)] core/src/db/lookups.ts:15-19 <-> core/src/db/lookups.ts:21-25 <-> core/src/db/lookups.ts:27-31

## /Users/ryan/Projects/captain-obvious/core/src/db/rules.ts

Rule Duplicate functions (lint-dup-fn):
Rule intent: Detects duplicated function bodies (AST clones) in production code.
Violations:
- line 74:1 [duplicate function body (2 sites, 48 nodes, same-file)] identical α-normalized body: core/src/db/rules.ts:74 linkCategories ↔ core/src/db/rules.ts:87 linkStages. same body under different names — collapse to one.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 74:1 [clone cluster (48 nodes)] core/src/db/rules.ts:74-84 <-> core/src/db/rules.ts:87-93

## /Users/ryan/Projects/captain-obvious/core/src/rules/__tests__/claudeGuard.test.ts

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 26:1 [clone cluster (20 nodes)] core/src/rules/__tests__/claudeGuard.test.ts:26-30 <-> core/src/rules/__tests__/claudeGuard.test.ts:36-40

## /Users/ryan/Projects/captain-obvious/core/src/rules/__tests__/config.test.ts

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 5:1 [duplicate code (15 lines)] duplicates core/src/rules/__tests__/dispatch.test.ts:4-18. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/core/src/rules/__tests__/dispatch-activity-coverage.test.ts

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 2:1 [duplicate code (6 lines)] duplicates core/src/server/__tests__/run.test.ts:2-8. Extract a shared helper instead of copying.
- line 4:1 [duplicate code (12 lines)] duplicates core/src/rules/__tests__/dispatch-runner.test.ts:5-17. Extract a shared helper instead of copying.
- line 39:1 [duplicate code (11 lines)] duplicates core/src/rules/__tests__/dispatch-runner.test.ts:21-31. Extract a shared helper instead of copying.
- line 66:1 [duplicate code (9 lines)] duplicates core/src/rules/__tests__/dispatch-runner.test.ts:68-76. Extract a shared helper instead of copying.
- line 75:1 [duplicate code (19 lines)] duplicates core/src/rules/__tests__/dispatch-runner.test.ts:77-96. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 33:1 [clone cluster (29 nodes)] core/src/rules/__tests__/dispatch-activity-coverage.test.ts:33-37 <-> core/src/rules/__tests__/dispatch-runner.test.ts:32-36
- line 40:1 [clone cluster (60 nodes)] core/src/rules/__tests__/dispatch-activity-coverage.test.ts:40-47 <-> core/src/rules/__tests__/dispatch-runner.test.ts:22-29
- line 65:1 [clone cluster (112 nodes)] core/src/rules/__tests__/dispatch-activity-coverage.test.ts:65-81 <-> core/src/rules/__tests__/dispatch-runner.test.ts:67-84
- line 83:1 [clone cluster (66 nodes)] core/src/rules/__tests__/dispatch-activity-coverage.test.ts:83-91 <-> core/src/rules/__tests__/dispatch-runner.test.ts:86-94

## /Users/ryan/Projects/captain-obvious/core/src/rules/__tests__/dispatch.test.ts

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 22:1 [clone cluster (25 nodes)] core/src/rules/__tests__/dispatch.test.ts:22-28 <-> core/src/rules/__tests__/dispatch.test.ts:30-34

## /Users/ryan/Projects/captain-obvious/core/src/rules/__tests__/fixtures/plugins-bad/missing-check/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 1:1 [unused file] no other module imports this file. Delete it, or add its entrypoint to knip.json if it is reached dynamically.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 1:1 [clone cluster (39 nodes)] core/src/rules/__tests__/fixtures/plugins-bad/missing-check/plugin.mjs:1-15 <-> core/src/rules/__tests__/fixtures/plugins-config/dup-rule/plugin.mjs:1-15
- line 2:1 [clone cluster (33 nodes)] core/src/rules/__tests__/fixtures/plugins-bad/missing-check/plugin.mjs:2-13 <-> core/src/rules/__tests__/fixtures/plugins-config/dup-rule/plugin.mjs:2-13 <-> core/src/rules/__tests__/fixtures/plugins-ok/good-rule/plugin.mjs:3-14

## /Users/ryan/Projects/captain-obvious/core/src/rules/__tests__/fixtures/plugins-config/dup-rule/check.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 1:1 [unused file] no other module imports this file. Delete it, or add its entrypoint to knip.json if it is reached dynamically.

## /Users/ryan/Projects/captain-obvious/core/src/rules/__tests__/fixtures/plugins-config/dup-rule/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 1:1 [unused file] no other module imports this file. Delete it, or add its entrypoint to knip.json if it is reached dynamically.

## /Users/ryan/Projects/captain-obvious/core/src/rules/__tests__/fixtures/plugins-noslug/noslug/check.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 1:1 [unused file] no other module imports this file. Delete it, or add its entrypoint to knip.json if it is reached dynamically.

## /Users/ryan/Projects/captain-obvious/core/src/rules/__tests__/fixtures/plugins-noslug/noslug/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 1:1 [unused file] no other module imports this file. Delete it, or add its entrypoint to knip.json if it is reached dynamically.

## /Users/ryan/Projects/captain-obvious/core/src/rules/__tests__/fixtures/plugins-ok/_shared/keep.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 1:1 [unused file] no other module imports this file. Delete it, or add its entrypoint to knip.json if it is reached dynamically.

## /Users/ryan/Projects/captain-obvious/core/src/rules/__tests__/fixtures/plugins-ok/good-rule/check.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 1:1 [unused file] no other module imports this file. Delete it, or add its entrypoint to knip.json if it is reached dynamically.

## /Users/ryan/Projects/captain-obvious/core/src/rules/__tests__/fixtures/plugins-ok/good-rule/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 1:1 [unused file] no other module imports this file. Delete it, or add its entrypoint to knip.json if it is reached dynamically.

## /Users/ryan/Projects/captain-obvious/core/src/rules/__tests__/load.test.ts

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 138:1 [clone cluster (38 nodes)] core/src/rules/__tests__/load.test.ts:138-142 <-> core/src/rules/__tests__/load.test.ts:144-148 <-> core/src/rules/__tests__/load.test.ts:150-154

## /Users/ryan/Projects/captain-obvious/core/src/rules/__tests__/protectedPaths.test.ts

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 14:1 [clone cluster (27 nodes)] core/src/rules/__tests__/protectedPaths.test.ts:14-17 <-> core/src/rules/__tests__/protectedPaths.test.ts:19-22 <-> rules/__tests__/lint-shared.test.mjs:111-114

## /Users/ryan/Projects/captain-obvious/core/src/rules/claudeGuard.ts

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 20:13 [unused type `GuardRun`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/core/src/rules/languages.ts

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 23:1 [clone cluster (26 nodes)] core/src/rules/languages.ts:23-28 <-> rules/lint-test-disabling-skipping/check.mjs:201-201
- line 23:1 [clone cluster (21 nodes)] core/src/rules/languages.ts:23-28 <-> rules/lint-test-disabling-skipping/check.mjs:201-201

## /Users/ryan/Projects/captain-obvious/core/src/rules/plugin.ts

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 16:15 [unused type `Language`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.
- line 16:25 [unused type `LintMode`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.
- line 16:35 [unused type `RuleCategory`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.
- line 16:49 [unused type `Stage`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.
- line 23:13 [unused type `ControlField`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.
- line 70:18 [unused type `RulePluginMeta`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/core/src/server/__tests__/analyze.test.ts

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 74:1 [clone cluster (24 nodes)] core/src/server/__tests__/analyze.test.ts:74-77 <-> core/src/server/__tests__/run.test.ts:104-107

## /Users/ryan/Projects/captain-obvious/core/src/server/__tests__/fix.test.ts

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 2:1 [duplicate code (13 lines)] duplicates core/src/server/__tests__/run.test.ts:2-14. Extract a shared helper instead of copying.
- line 40:1 [duplicate code (14 lines)] duplicates core/src/server/__tests__/run.test.ts:33-46. Extract a shared helper instead of copying.
- line 304:1 [duplicate code (8 lines)] duplicates core/src/server/__tests__/fix.test.ts:280-287. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 7:1 [clone cluster (45 nodes)] core/src/server/__tests__/fix.test.ts:7-12 <-> core/src/server/__tests__/run.test.ts:7-12
- line 7:1 [clone cluster (42 nodes)] core/src/server/__tests__/fix.test.ts:7-12 <-> core/src/server/__tests__/run.test.ts:7-12
- line 9:1 [clone cluster (29 nodes)] core/src/server/__tests__/fix.test.ts:9-10 <-> core/src/server/__tests__/run.test.ts:9-10
- line 39:1 [clone cluster (107 nodes)] core/src/server/__tests__/fix.test.ts:39-50 <-> core/src/server/__tests__/run.test.ts:29-43
- line 43:1 [clone cluster (58 nodes)] core/src/server/__tests__/fix.test.ts:43-48 <-> core/src/server/__tests__/run.test.ts:36-41

## /Users/ryan/Projects/captain-obvious/core/src/server/__tests__/panelExt.dom.test.ts

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 324:1 [clone cluster (32 nodes)] core/src/server/__tests__/panelExt.dom.test.ts:324-327 <-> core/src/server/__tests__/panelExt.dom.test.ts:358-361
- line 425:1 [clone cluster (28 nodes)] core/src/server/__tests__/panelExt.dom.test.ts:425-428 <-> core/src/server/__tests__/panelExt.dom.test.ts:440-443 <-> core/src/server/__tests__/panelExt.dom.test.ts:1289-1290
- line 654:1 [clone cluster (52 nodes)] core/src/server/__tests__/panelExt.dom.test.ts:654-661 <-> core/src/server/__tests__/panelExt.dom.test.ts:1243-1250
- line 836:1 [clone cluster (26 nodes)] core/src/server/__tests__/panelExt.dom.test.ts:836-836 <-> core/src/server/__tests__/panelExt.dom.test.ts:837-837 <-> core/src/server/__tests__/panelExt.dom.test.ts:913-913

## /Users/ryan/Projects/captain-obvious/core/src/server/__tests__/registry.test.ts

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 57:1 [clone cluster (26 nodes)] core/src/server/__tests__/registry.test.ts:57-60 <-> core/src/server/__tests__/registry.test.ts:139-142
- line 394:1 [clone cluster (21 nodes)] core/src/server/__tests__/registry.test.ts:394-399 <-> core/src/server/__tests__/registry.test.ts:415-420

## /Users/ryan/Projects/captain-obvious/core/src/server/__tests__/run.test.ts

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 297:1 [duplicate code (7 lines)] duplicates core/src/server/__tests__/run.test.ts:289-295. Extract a shared helper instead of copying.
- line 313:1 [duplicate code (7 lines)] duplicates core/src/server/__tests__/run.test.ts:305-311. Extract a shared helper instead of copying.
- line 321:1 [duplicate code (8 lines)] duplicates core/src/server/__tests__/run.test.ts:270-277. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 287:1 [clone cluster (49 nodes)] core/src/server/__tests__/run.test.ts:287-293 <-> core/src/server/__tests__/run.test.ts:295-301
- line 303:1 [clone cluster (49 nodes)] core/src/server/__tests__/run.test.ts:303-309 <-> core/src/server/__tests__/run.test.ts:311-317

## /Users/ryan/Projects/captain-obvious/core/src/server/activity.ts

Rule Duplicate functions (lint-dup-fn):
Rule intent: Detects duplicated function bodies (AST clones) in production code.
Violations:
- line 50:1 [duplicate function body (2 sites, 21 nodes, cross-file)] identical α-normalized body: core/src/server/activity.ts:50 openProfile ↔ core/src/server/profiling.ts:25 open. same body reinvented across files — extract a shared helper.
- line 30:1 [duplicate function body (2 sites, 29 nodes, same-file)] identical α-normalized body: core/src/server/activity.ts:30 slugToKey ↔ core/src/server/activity.ts:33 keyToSlug. same body under different names — collapse to one.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 30:1 [clone cluster (29 nodes)] core/src/server/activity.ts:30-32 <-> core/src/server/activity.ts:33-35
- line 50:1 [clone cluster (21 nodes)] core/src/server/activity.ts:50-52 <-> core/src/server/profiling.ts:25-27

## /Users/ryan/Projects/captain-obvious/core/src/server/registry.ts

Rule Duplicate functions (lint-dup-fn):
Rule intent: Detects duplicated function bodies (AST clones) in production code.
Violations:
- line 363:1 [duplicate function body (2 sites, 39 nodes, same-file)] identical α-normalized body: core/src/server/registry.ts:363 currentLanguages ↔ core/src/server/registry.ts:378 currentCategories. same body under different names — collapse to one.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 363:1 [clone cluster (39 nodes)] core/src/server/registry.ts:363-375 <-> core/src/server/registry.ts:378-389
- line 401:1 [clone cluster (28 nodes)] core/src/server/registry.ts:401-405 <-> core/src/server/registry.ts:622-626

## /Users/ryan/Projects/captain-obvious/core/src/server/serve.ts

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 319:1 [clone cluster (25 nodes)] core/src/server/serve.ts:319-322 <-> core/src/server/serve.ts:330-333

## /Users/ryan/Projects/captain-obvious/core/web/dist/assets/index-CstP_qYX.js

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 1:1 [unused file] no other module imports this file. Delete it, or add its entrypoint to knip.json if it is reached dynamically.

## /Users/ryan/Projects/captain-obvious/hooks/claude/protected-paths-guard.mjs

Rule Max statements per function (lint-max-statements):
Rule intent: Flags functions with more than the allowed number of statements.
Violations:
- line 24:1 [max-statements] fn "runClaudeGuard" has 29 statements (limit 20)

## /Users/ryan/Projects/captain-obvious/rules/__tests__/ast-fingerprint.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 52:1 [clone cluster (22 nodes)] rules/__tests__/ast-fingerprint.test.mjs:52-57 <-> rules/__tests__/ast-fingerprint.test.mjs:61-66
- line 100:1 [clone cluster (22 nodes)] rules/__tests__/ast-fingerprint.test.mjs:100-105 <-> rules/__tests__/ast-fingerprint.test.mjs:107-112 <-> rules/__tests__/ast-fingerprint.test.mjs:115-120 <-> rules/__tests__/ast-fingerprint.test.mjs:136-139

## /Users/ryan/Projects/captain-obvious/rules/__tests__/check-main-ci-green.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 205:1 [duplicate code (17 lines)] duplicates rules/__tests__/lint-sync-calls.test.mjs:154-172. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 95:1 [clone cluster (21 nodes)] rules/__tests__/check-main-ci-green.test.mjs:95-99 <-> rules/__tests__/check-main-ci-green.test.mjs:101-105
- line 218:1 [clone cluster (21 nodes)] rules/__tests__/check-main-ci-green.test.mjs:218-218 <-> rules/__tests__/check-main-ci-green.test.mjs:219-219 <-> rules/__tests__/gov-no-push-to-main.test.mjs:22-22 <-> rules/__tests__/gov-no-push-to-main.test.mjs:23-23 <-> rules/__tests__/lint-comments.test.mjs:138-138 <-> rules/__tests__/lint-comments.test.mjs:139-139 <-> rules/__tests__/lint-dead-code.test.mjs:159-159 <-> rules/__tests__/lint-dead-code.test.mjs:160-160 <-> rules/__tests__/lint-emitter-casing.test.mjs:282-282 <-> rules/__tests__/lint-emitter-casing.test.mjs:283-283 <-> rules/__tests__/lint-prettier.test.mjs:145-145 <-> rules/__tests__/lint-prettier.test.mjs:146-146 <-> rules/__tests__/lint-protected-paths.test.mjs:40-40 <-> rules/__tests__/lint-protected-paths.test.mjs:41-41 <-> rules/__tests__/lint-sync-calls.test.mjs:169-169 <-> rules/__tests__/lint-sync-calls.test.mjs:170-170

## /Users/ryan/Projects/captain-obvious/rules/__tests__/dup-fn-metrics.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 54:1 [clone cluster (36 nodes)] rules/__tests__/dup-fn-metrics.test.mjs:54-66 <-> rules/__tests__/dup-fn-metrics.test.mjs:73-81

## /Users/ryan/Projects/captain-obvious/rules/__tests__/dup-ratchet.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 9:1 [clone cluster (21 nodes)] rules/__tests__/dup-ratchet.test.mjs:9-12 <-> rules/__tests__/dup-ratchet.test.mjs:14-17 <-> rules/__tests__/dup-ratchet.test.mjs:32-35

## /Users/ryan/Projects/captain-obvious/rules/__tests__/dup-structural-metrics.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 61:1 [clone cluster (35 nodes)] rules/__tests__/dup-structural-metrics.test.mjs:61-73 <-> rules/__tests__/lint-prettier.test.mjs:113-118
- line 106:1 [clone cluster (33 nodes)] rules/__tests__/dup-structural-metrics.test.mjs:106-112 <-> rules/__tests__/dup-structural-metrics.test.mjs:113-119

## /Users/ryan/Projects/captain-obvious/rules/__tests__/fn-metrics-runner.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 84:1 [clone cluster (24 nodes)] rules/__tests__/fn-metrics-runner.test.mjs:84-87 <-> rules/__tests__/lint-metric-wrappers.test.mjs:31-34
- line 89:1 [clone cluster (57 nodes)] rules/__tests__/fn-metrics-runner.test.mjs:89-98 <-> rules/__tests__/fn-metrics-runner.test.mjs:146-153
- line 119:1 [clone cluster (21 nodes)] rules/__tests__/fn-metrics-runner.test.mjs:119-122 <-> rules/__tests__/fn-metrics-runner.test.mjs:136-139

## /Users/ryan/Projects/captain-obvious/rules/__tests__/gov-no-push-to-main.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 10:1 [duplicate code (11 lines)] duplicates rules/__tests__/lint-sync-calls.test.mjs:155-156. Extract a shared helper instead of copying.
- line 19:1 [duplicate code (7 lines)] duplicates rules/__tests__/lint-sync-calls.test.mjs:166-172. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-comments.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 122:1 [duplicate code (26 lines)] duplicates rules/__tests__/lint-sync-calls.test.mjs:153-178. Extract a shared helper instead of copying.
- line 188:1 [duplicate code (6 lines)] duplicates rules/__tests__/lint-sync-calls.test.mjs:198-203. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 29:1 [clone cluster (49 nodes)] rules/__tests__/lint-comments.test.mjs:29-35 <-> rules/__tests__/lint-comments.test.mjs:57-63
- line 121:1 [clone cluster (82 nodes)] rules/__tests__/lint-comments.test.mjs:121-129 <-> rules/__tests__/lint-emitter-casing.test.mjs:265-273 <-> rules/__tests__/lint-protected-paths.test.mjs:22-30 <-> rules/__tests__/lint-sync-calls.test.mjs:152-160
- line 130:1 [clone cluster (30 nodes)] rules/__tests__/lint-comments.test.mjs:130-136 <-> rules/__tests__/lint-emitter-casing.test.mjs:274-280 <-> rules/__tests__/lint-prettier.test.mjs:137-143 <-> rules/__tests__/lint-protected-paths.test.mjs:32-38 <-> rules/__tests__/lint-sync-calls.test.mjs:161-167
- line 141:1 [clone cluster (36 nodes)] rules/__tests__/lint-comments.test.mjs:141-145 <-> rules/__tests__/lint-dead-code.test.mjs:283-287 <-> rules/__tests__/lint-sync-calls.test.mjs:172-176
- line 156:1 [clone cluster (62 nodes)] rules/__tests__/lint-comments.test.mjs:156-165 <-> rules/__tests__/lint-sync-calls.test.mjs:185-194
- line 186:1 [clone cluster (65 nodes)] rules/__tests__/lint-comments.test.mjs:186-195 <-> rules/__tests__/lint-sync-calls.test.mjs:196-205 <-> rules/__tests__/lint-sync-calls.test.mjs:219-228

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-coverage.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 71:1 [duplicate code (9 lines)] duplicates rules/__tests__/lint-test-determinism.test.mjs:61-69. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 68:1 [clone cluster (20 nodes)] rules/__tests__/lint-coverage.test.mjs:68-72 <-> rules/__tests__/lint-dup-fn.integration.test.mjs:41-45 <-> rules/__tests__/lint-dup-structural.defensive.test.mjs:56-60 <-> rules/__tests__/lint-dup-structural.modes.test.mjs:42-46 <-> rules/__tests__/lint-dup.modes.test.mjs:42-46 <-> rules/__tests__/lint-solid-s.test.mjs:423-427
- line 74:1 [clone cluster (34 nodes)] rules/__tests__/lint-coverage.test.mjs:74-77 <-> rules/__tests__/lint-empty-tests.test.mjs:55-58 <-> rules/__tests__/lint-max-file-lines.test.mjs:65-68 <-> rules/__tests__/lint-max-line-length.test.mjs:54-57 <-> rules/__tests__/lint-test-determinism.test.mjs:64-67

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-dead-code.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 145:1 [duplicate code (8 lines)] duplicates rules/__tests__/lint-sync-calls.test.mjs:154-161. Extract a shared helper instead of copying.
- line 156:1 [duplicate code (7 lines)] duplicates rules/__tests__/lint-sync-calls.test.mjs:166-172. Extract a shared helper instead of copying.
- line 256:1 [duplicate code (6 lines)] duplicates rules/__tests__/lint-dead-code.test.mjs:229-234. Extract a shared helper instead of copying.
- line 263:1 [duplicate code (7 lines)] duplicates rules/__tests__/lint-dead-code.test.mjs:187-193. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 162:1 [clone cluster (38 nodes)] rules/__tests__/lint-dead-code.test.mjs:162-167 <-> rules/__tests__/lint-dead-code.test.mjs:197-202 <-> rules/__tests__/lint-dead-code.test.mjs:215-220
- line 170:1 [clone cluster (21 nodes)] rules/__tests__/lint-dead-code.test.mjs:170-172 <-> rules/__tests__/lint-dead-code.test.mjs:182-184 <-> rules/__tests__/lint-dead-code.test.mjs:205-207 <-> rules/__tests__/lint-dead-code.test.mjs:231-233 <-> rules/__tests__/lint-dead-code.test.mjs:248-250 <-> rules/__tests__/lint-dead-code.test.mjs:258-260

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-dup-fn.integration.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 35:1 [duplicate code (13 lines)] duplicates rules/__tests__/lint-solid-s.test.mjs:418-48. Extract a shared helper instead of copying.
- line 145:1 [duplicate code (6 lines)] duplicates rules/__tests__/lint-dup.modes.test.mjs:212-217. Extract a shared helper instead of copying.
- line 167:1 [duplicate code (15 lines)] duplicates rules/__tests__/lint-dup.modes.test.mjs:66-168. Extract a shared helper instead of copying.
- line 200:1 [duplicate code (9 lines)] duplicates rules/__tests__/lint-dup.modes.test.mjs:144-152. Extract a shared helper instead of copying.
- line 214:1 [duplicate code (11 lines)] duplicates rules/__tests__/lint-dup.modes.test.mjs:70-168. Extract a shared helper instead of copying.
- line 224:1 [duplicate code (11 lines)] duplicates rules/__tests__/lint-dup.modes.test.mjs:168-178. Extract a shared helper instead of copying.
- line 251:1 [duplicate code (9 lines)] duplicates rules/__tests__/lint-dup-structural.modes.test.mjs:148-261. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 34:1 [clone cluster (32 nodes)] rules/__tests__/lint-dup-fn.integration.test.mjs:34-39 <-> rules/__tests__/lint-dup-structural.defensive.test.mjs:49-54 <-> rules/__tests__/lint-dup-structural.modes.test.mjs:35-40 <-> rules/__tests__/lint-dup.modes.test.mjs:35-40 <-> rules/__tests__/lint-solid-s.test.mjs:417-422
- line 47:1 [clone cluster (30 nodes)] rules/__tests__/lint-dup-fn.integration.test.mjs:47-50 <-> rules/__tests__/lint-dup.modes.test.mjs:48-51
- line 97:1 [clone cluster (47 nodes)] rules/__tests__/lint-dup-fn.integration.test.mjs:97-104 <-> rules/__tests__/lint-dup.modes.test.mjs:220-227
- line 133:1 [clone cluster (46 nodes)] rules/__tests__/lint-dup-fn.integration.test.mjs:133-142 <-> rules/__tests__/lint-dup.modes.test.mjs:181-189
- line 191:1 [clone cluster (57 nodes)] rules/__tests__/lint-dup-fn.integration.test.mjs:191-198 <-> rules/__tests__/lint-dup.modes.test.mjs:133-142
- line 200:1 [clone cluster (42 nodes)] rules/__tests__/lint-dup-fn.integration.test.mjs:200-206 <-> rules/__tests__/lint-dup-structural.modes.test.mjs:137-143 <-> rules/__tests__/lint-dup.modes.test.mjs:144-150
- line 255:1 [clone cluster (33 nodes)] rules/__tests__/lint-dup-fn.integration.test.mjs:255-258 <-> rules/__tests__/lint-dup-structural.modes.test.mjs:152-155 <-> rules/__tests__/lint-dup.modes.test.mjs:257-260

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-dup-structural.defensive.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 50:1 [duplicate code (13 lines)] duplicates rules/__tests__/lint-solid-s.test.mjs:418-429. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-dup-structural.modes.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 36:1 [duplicate code (13 lines)] duplicates rules/__tests__/lint-solid-s.test.mjs:418-429. Extract a shared helper instead of copying.
- line 49:1 [duplicate code (8 lines)] duplicates rules/__tests__/lint-dup.modes.test.mjs:182-188. Extract a shared helper instead of copying.
- line 61:1 [duplicate code (6 lines)] duplicates rules/__tests__/lint-dup.modes.test.mjs:212-217. Extract a shared helper instead of copying.
- line 95:1 [duplicate code (10 lines)] duplicates rules/__tests__/lint-dup-structural.modes.test.mjs:78-87. Extract a shared helper instead of copying.
- line 102:1 [duplicate code (13 lines)] duplicates rules/__tests__/lint-dup.modes.test.mjs:66-78. Extract a shared helper instead of copying.
- line 137:1 [duplicate code (9 lines)] duplicates rules/__tests__/lint-dup.modes.test.mjs:144-152. Extract a shared helper instead of copying.
- line 149:1 [duplicate code (9 lines)] duplicates rules/__tests__/lint-dup.modes.test.mjs:254-261. Extract a shared helper instead of copying.
- line 176:1 [duplicate code (8 lines)] duplicates rules/__tests__/lint-dup-structural.modes.test.mjs:165-172. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-dup.modes.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 36:1 [duplicate code (13 lines)] duplicates rules/__tests__/lint-solid-s.test.mjs:418-429. Extract a shared helper instead of copying.
- line 158:1 [duplicate code (8 lines)] duplicates rules/__tests__/lint-dup.modes.test.mjs:70-77. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 111:1 [clone cluster (45 nodes)] rules/__tests__/lint-dup.modes.test.mjs:111-119 <-> rules/__tests__/lint-dup.modes.test.mjs:123-131

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-dup.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 76:1 [clone cluster (36 nodes)] rules/__tests__/lint-dup.test.mjs:76-80 <-> rules/__tests__/lint-dup.test.mjs:82-86

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-emitter-casing.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 213:1 [duplicate code (7 lines)] duplicates rules/__tests__/lint-empty-catch.test.mjs:161-167. Extract a shared helper instead of copying.
- line 266:1 [duplicate code (20 lines)] duplicates rules/__tests__/lint-sync-calls.test.mjs:153-172. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 26:1 [clone cluster (21 nodes)] rules/__tests__/lint-emitter-casing.test.mjs:26-33 <-> rules/__tests__/lint-naming.test.mjs:39-42
- line 62:1 [clone cluster (40 nodes)] rules/__tests__/lint-emitter-casing.test.mjs:62-68 <-> rules/__tests__/lint-emitter-casing.test.mjs:109-115
- line 70:1 [clone cluster (20 nodes)] rules/__tests__/lint-emitter-casing.test.mjs:70-73 <-> rules/__tests__/lint-solid-i.test.mjs:152-155
- line 75:1 [clone cluster (23 nodes)] rules/__tests__/lint-emitter-casing.test.mjs:75-80 <-> rules/__tests__/lint-emitter-casing.test.mjs:90-95 <-> rules/__tests__/lint-emitter-casing.test.mjs:97-102 <-> rules/__tests__/lint-emitter-casing.test.mjs:104-107 <-> rules/__tests__/lint-emitter-casing.test.mjs:117-120 <-> rules/__tests__/lint-emitter-casing.test.mjs:122-125 <-> rules/__tests__/lint-emitter-casing.test.mjs:127-132 <-> rules/__tests__/lint-emitter-casing.test.mjs:134-138 <-> rules/__tests__/lint-emitter-casing.test.mjs:147-151
- line 153:1 [clone cluster (40 nodes)] rules/__tests__/lint-emitter-casing.test.mjs:153-161 <-> rules/__tests__/lint-emitter-casing.test.mjs:170-175
- line 163:1 [clone cluster (37 nodes)] rules/__tests__/lint-emitter-casing.test.mjs:163-168 <-> rules/__tests__/lint-emitter-casing.test.mjs:177-183
- line 194:1 [clone cluster (57 nodes)] rules/__tests__/lint-emitter-casing.test.mjs:194-200 <-> rules/__tests__/lint-empty-catch.test.mjs:126-132
- line 211:1 [clone cluster (51 nodes)] rules/__tests__/lint-emitter-casing.test.mjs:211-217 <-> rules/__tests__/lint-empty-catch.test.mjs:159-165
- line 238:1 [clone cluster (27 nodes)] rules/__tests__/lint-emitter-casing.test.mjs:238-242 <-> rules/__tests__/lint-emitter-casing.test.mjs:252-256
- line 291:1 [clone cluster (29 nodes)] rules/__tests__/lint-emitter-casing.test.mjs:291-296 <-> rules/__tests__/lint-prettier.test.mjs:148-153

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-empty-catch.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 285:1 [duplicate code (9 lines)] duplicates rules/__tests__/lint-sync-calls.test.mjs:154-162. Extract a shared helper instead of copying.
- line 396:1 [duplicate code (8 lines)] duplicates rules/__tests__/lint-sync-calls.test.mjs:244-249. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 40:1 [clone cluster (37 nodes)] rules/__tests__/lint-empty-catch.test.mjs:40-45 <-> rules/__tests__/lint-empty-catch.test.mjs:47-52 <-> rules/__tests__/lint-empty-catch.test.mjs:54-59 <-> rules/__tests__/lint-empty-catch.test.mjs:61-66
- line 143:1 [clone cluster (45 nodes)] rules/__tests__/lint-empty-catch.test.mjs:143-149 <-> rules/__tests__/lint-empty-catch.test.mjs:151-157
- line 206:1 [clone cluster (27 nodes)] rules/__tests__/lint-empty-catch.test.mjs:206-210 <-> rules/__tests__/lint-sync-calls.test.mjs:93-97
- line 256:1 [clone cluster (33 nodes)] rules/__tests__/lint-empty-catch.test.mjs:256-261 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:464-468
- line 264:1 [clone cluster (40 nodes)] rules/__tests__/lint-empty-catch.test.mjs:264-277 <-> rules/__tests__/lint-naming.test.mjs:148-161
- line 265:1 [clone cluster (33 nodes)] rules/__tests__/lint-empty-catch.test.mjs:265-276 <-> rules/__tests__/lint-naming.test.mjs:149-160
- line 333:1 [clone cluster (37 nodes)] rules/__tests__/lint-empty-catch.test.mjs:333-338 <-> rules/__tests__/lint-sync-calls.test.mjs:178-183
- line 340:1 [clone cluster (85 nodes)] rules/__tests__/lint-empty-catch.test.mjs:340-353 <-> rules/__tests__/lint-empty-catch.test.mjs:368-381

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-empty-tests.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 36:1 [duplicate code (11 lines)] duplicates rules/__tests__/lint-test-determinism.test.mjs:45-55. Extract a shared helper instead of copying.
- line 46:1 [duplicate code (15 lines)] duplicates rules/__tests__/lint-test-determinism.test.mjs:55-69. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 15:1 [clone cluster (29 nodes)] rules/__tests__/lint-empty-tests.test.mjs:15-18 <-> rules/__tests__/lint-empty-tests.test.mjs:20-23
- line 36:1 [clone cluster (265 nodes)] rules/__tests__/lint-empty-tests.test.mjs:36-79 <-> rules/__tests__/lint-test-determinism.test.mjs:45-88
- line 39:1 [clone cluster (25 nodes)] rules/__tests__/lint-empty-tests.test.mjs:39-43 <-> rules/__tests__/lint-test-determinism.test.mjs:48-52
- line 45:1 [clone cluster (22 nodes)] rules/__tests__/lint-empty-tests.test.mjs:45-48 <-> rules/__tests__/lint-naming.test.mjs:188-191 <-> rules/__tests__/lint-solid-i.test.mjs:218-221 <-> rules/__tests__/lint-solid-l.test.mjs:125-128 <-> rules/__tests__/lint-solid-o.test.mjs:147-150 <-> rules/__tests__/lint-solid-s.test.mjs:292-295 <-> rules/__tests__/lint-test-determinism.test.mjs:54-57
- line 60:1 [clone cluster (44 nodes)] rules/__tests__/lint-empty-tests.test.mjs:60-64 <-> rules/__tests__/lint-test-determinism.test.mjs:69-73
- line 66:1 [clone cluster (47 nodes)] rules/__tests__/lint-empty-tests.test.mjs:66-71 <-> rules/__tests__/lint-test-determinism.test.mjs:75-80
- line 73:1 [clone cluster (48 nodes)] rules/__tests__/lint-empty-tests.test.mjs:73-78 <-> rules/__tests__/lint-test-determinism.test.mjs:82-87

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-fn-metrics.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 170:1 [clone cluster (43 nodes)] rules/__tests__/lint-fn-metrics.test.mjs:170-175 <-> rules/__tests__/lint-solid-l.test.mjs:106-111 <-> rules/__tests__/lint-solid-o.test.mjs:136-141 <-> rules/__tests__/lint-solid-s.test.mjs:264-269
- line 190:1 [clone cluster (24 nodes)] rules/__tests__/lint-fn-metrics.test.mjs:190-193 <-> rules/__tests__/lint-fn-metrics.test.mjs:195-198
- line 200:1 [clone cluster (24 nodes)] rules/__tests__/lint-fn-metrics.test.mjs:200-203 <-> rules/__tests__/lint-fn-metrics.test.mjs:205-208

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-frozen-interfaces.integration.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 21:1 [duplicate code (9 lines)] duplicates rules/__tests__/lint-frozen-interfaces.runner.test.mjs:137-145. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 20:1 [clone cluster (33 nodes)] rules/__tests__/lint-frozen-interfaces.integration.test.mjs:20-24 <-> rules/__tests__/lint-frozen-interfaces.runner.test.mjs:136-140

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-frozen-interfaces.runner.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 167:1 [clone cluster (41 nodes)] rules/__tests__/lint-frozen-interfaces.runner.test.mjs:167-173 <-> rules/__tests__/lint-frozen-interfaces.runner.test.mjs:175-181

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-frozen-interfaces.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 37:1 [clone cluster (22 nodes)] rules/__tests__/lint-frozen-interfaces.test.mjs:37-40 <-> rules/__tests__/lint-frozen-interfaces.test.mjs:141-144 <-> rules/__tests__/lint-frozen-interfaces.test.mjs:145-150 <-> rules/__tests__/lint-frozen-interfaces.test.mjs:151-154 <-> rules/__tests__/lint-frozen-interfaces.test.mjs:164-167 <-> rules/__tests__/lint-frozen-interfaces.test.mjs:174-178
- line 95:1 [clone cluster (24 nodes)] rules/__tests__/lint-frozen-interfaces.test.mjs:95-100 <-> rules/__tests__/lint-frozen-interfaces.test.mjs:101-106 <-> rules/__tests__/lint-frozen-interfaces.test.mjs:107-114 <-> rules/__tests__/lint-frozen-interfaces.test.mjs:119-124 <-> rules/__tests__/lint-frozen-interfaces.test.mjs:132-137

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-max-file-lines.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 47:1 [duplicate code (17 lines)] duplicates rules/__tests__/lint-max-line-length.test.mjs:36-52. Extract a shared helper instead of copying.
- line 63:1 [duplicate code (9 lines)] duplicates rules/__tests__/lint-max-line-length.test.mjs:52-60. Extract a shared helper instead of copying.
- line 71:1 [duplicate code (10 lines)] duplicates rules/__tests__/lint-max-line-length.test.mjs:60-69. Extract a shared helper instead of copying.
- line 93:1 [duplicate code (9 lines)] duplicates rules/__tests__/lint-max-line-length.test.mjs:82-90. Extract a shared helper instead of copying.
- line 101:1 [duplicate code (7 lines)] duplicates rules/__tests__/lint-max-line-length.test.mjs:90-96. Extract a shared helper instead of copying.
- line 124:1 [duplicate code (13 lines)] duplicates rules/__tests__/lint-max-line-length.test.mjs:113-125. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 70:1 [clone cluster (58 nodes)] rules/__tests__/lint-max-file-lines.test.mjs:70-78 <-> rules/__tests__/lint-max-line-length.test.mjs:59-67
- line 80:1 [clone cluster (70 nodes)] rules/__tests__/lint-max-file-lines.test.mjs:80-88 <-> rules/__tests__/lint-max-line-length.test.mjs:69-77
- line 90:1 [clone cluster (59 nodes)] rules/__tests__/lint-max-file-lines.test.mjs:90-98 <-> rules/__tests__/lint-max-line-length.test.mjs:79-87
- line 100:1 [clone cluster (72 nodes)] rules/__tests__/lint-max-file-lines.test.mjs:100-109 <-> rules/__tests__/lint-max-line-length.test.mjs:89-98
- line 111:1 [clone cluster (70 nodes)] rules/__tests__/lint-max-file-lines.test.mjs:111-119 <-> rules/__tests__/lint-max-line-length.test.mjs:100-108
- line 121:1 [clone cluster (74 nodes)] rules/__tests__/lint-max-file-lines.test.mjs:121-130 <-> rules/__tests__/lint-max-line-length.test.mjs:110-119

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-naming.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 18:1 [clone cluster (23 nodes)] rules/__tests__/lint-naming.test.mjs:18-21 <-> rules/__tests__/lint-naming.test.mjs:29-38
- line 22:1 [clone cluster (21 nodes)] rules/__tests__/lint-naming.test.mjs:22-25 <-> rules/__tests__/lint-naming.test.mjs:43-46
- line 50:1 [clone cluster (26 nodes)] rules/__tests__/lint-naming.test.mjs:50-58 <-> rules/__tests__/lint-naming.test.mjs:82-90
- line 92:1 [clone cluster (32 nodes)] rules/__tests__/lint-naming.test.mjs:92-96 <-> rules/__tests__/lint-naming.test.mjs:98-102
- line 172:1 [clone cluster (49 nodes)] rules/__tests__/lint-naming.test.mjs:172-178 <-> rules/__tests__/lint-sync-calls.test.mjs:114-120
- line 197:1 [clone cluster (33 nodes)] rules/__tests__/lint-naming.test.mjs:197-200 <-> rules/__tests__/lint-solid-d.test.mjs:320-325 <-> rules/__tests__/lint-solid-i.test.mjs:239-244 <-> rules/__tests__/lint-solid-l.test.mjs:134-139 <-> rules/__tests__/lint-solid-o.test.mjs:156-161 <-> rules/__tests__/lint-solid-s.test.mjs:301-304
- line 202:1 [clone cluster (39 nodes)] rules/__tests__/lint-naming.test.mjs:202-207 <-> rules/__tests__/lint-naming.test.mjs:220-225 <-> rules/__tests__/lint-solid-i.test.mjs:269-274 <-> rules/__tests__/lint-solid-l.test.mjs:160-165 <-> rules/__tests__/lint-solid-l.test.mjs:172-177 <-> rules/__tests__/lint-solid-o.test.mjs:194-199 <-> rules/__tests__/lint-solid-s.test.mjs:405-410

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-prettier.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 130:1 [duplicate code (13 lines)] duplicates rules/__tests__/lint-sync-calls.test.mjs:154-166. Extract a shared helper instead of copying.
- line 142:1 [duplicate code (7 lines)] duplicates rules/__tests__/lint-sync-calls.test.mjs:166-172. Extract a shared helper instead of copying.
- line 185:1 [duplicate code (9 lines)] duplicates rules/__tests__/lint-protected-paths.test.mjs:95-247. Extract a shared helper instead of copying.
- line 197:1 [duplicate code (9 lines)] duplicates rules/__tests__/lint-prettier.test.mjs:182-190. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 50:1 [clone cluster (20 nodes)] rules/__tests__/lint-prettier.test.mjs:50-52 <-> rules/__tests__/lint-prettier.test.mjs:70-72

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-protected-paths.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 23:1 [duplicate code (22 lines)] duplicates rules/__tests__/lint-sync-calls.test.mjs:153-173. Extract a shared helper instead of copying.
- line 97:1 [duplicate code (9 lines)] duplicates rules/__tests__/lint-sync-calls.test.mjs:241-249. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-shared.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 135:1 [clone cluster (33 nodes)] rules/__tests__/lint-shared.test.mjs:135-139 <-> rules/__tests__/lint-tests-with-code.test.mjs:38-42
- line 173:1 [clone cluster (35 nodes)] rules/__tests__/lint-shared.test.mjs:173-179 <-> rules/__tests__/lint-sync-calls.test.mjs:132-144
- line 174:1 [clone cluster (28 nodes)] rules/__tests__/lint-shared.test.mjs:174-178 <-> rules/__tests__/lint-sync-calls.test.mjs:133-143
- line 191:1 [clone cluster (35 nodes)] rules/__tests__/lint-shared.test.mjs:191-195 <-> rules/__tests__/lint-shared.test.mjs:197-201
- line 388:1 [clone cluster (20 nodes)] rules/__tests__/lint-shared.test.mjs:388-391 <-> rules/__tests__/lint-shared.test.mjs:395-398

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-solid-d.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 57:1 [clone cluster (22 nodes)] rules/__tests__/lint-solid-d.test.mjs:57-61 <-> rules/__tests__/lint-solid-d.test.mjs:62-65 <-> rules/__tests__/lint-solid-d.test.mjs:66-69
- line 70:1 [clone cluster (20 nodes)] rules/__tests__/lint-solid-d.test.mjs:70-73 <-> rules/__tests__/lint-solid-d.test.mjs:74-77
- line 113:1 [clone cluster (30 nodes)] rules/__tests__/lint-solid-d.test.mjs:113-122 <-> rules/__tests__/lint-solid-d.test.mjs:124-133
- line 201:1 [clone cluster (48 nodes)] rules/__tests__/lint-solid-d.test.mjs:201-217 <-> rules/__tests__/lint-solid-d.test.mjs:259-275

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-solid-i.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 31:1 [clone cluster (26 nodes)] rules/__tests__/lint-solid-i.test.mjs:31-37 <-> rules/__tests__/lint-solid-i.test.mjs:46-52
- line 38:1 [clone cluster (25 nodes)] rules/__tests__/lint-solid-i.test.mjs:38-41 <-> rules/__tests__/lint-solid-i.test.mjs:42-45

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-solid-l.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 13:1 [clone cluster (42 nodes)] rules/__tests__/lint-solid-l.test.mjs:13-18 <-> rules/__tests__/lint-solid-o.test.mjs:15-22
- line 31:1 [clone cluster (30 nodes)] rules/__tests__/lint-solid-l.test.mjs:31-37 <-> rules/__tests__/lint-solid-l.test.mjs:96-102 <-> rules/__tests__/lint-solid-o.test.mjs:54-60 <-> rules/__tests__/lint-solid-o.test.mjs:64-70
- line 105:1 [clone cluster (50 nodes)] rules/__tests__/lint-solid-l.test.mjs:105-112 <-> rules/__tests__/lint-solid-o.test.mjs:135-142
- line 114:1 [clone cluster (20 nodes)] rules/__tests__/lint-solid-l.test.mjs:114-120 <-> rules/__tests__/lint-solid-o.test.mjs:125-133
- line 141:1 [clone cluster (53 nodes)] rules/__tests__/lint-solid-l.test.mjs:141-149 <-> rules/__tests__/lint-solid-o.test.mjs:163-171 <-> rules/__tests__/lint-solid-s.test.mjs:306-312
- line 167:1 [clone cluster (27 nodes)] rules/__tests__/lint-solid-l.test.mjs:167-170 <-> rules/__tests__/lint-solid-o.test.mjs:189-192 <-> rules/__tests__/lint-solid-s.test.mjs:395-403

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-solid-o.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 182:1 [clone cluster (39 nodes)] rules/__tests__/lint-solid-o.test.mjs:182-187 <-> rules/__tests__/lint-solid-s.test.mjs:380-385

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-solid-s.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 355:1 [duplicate code (7 lines)] duplicates rules/__tests__/lint-solid-s.test.mjs:156-162. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 28:1 [clone cluster (30 nodes)] rules/__tests__/lint-solid-s.test.mjs:28-38 <-> rules/__tests__/lint-solid-s.test.mjs:198-208
- line 40:1 [clone cluster (31 nodes)] rules/__tests__/lint-solid-s.test.mjs:40-51 <-> rules/__tests__/lint-solid-s.test.mjs:64-75 <-> rules/__tests__/lint-solid-s.test.mjs:118-129
- line 53:1 [clone cluster (29 nodes)] rules/__tests__/lint-solid-s.test.mjs:53-62 <-> rules/__tests__/lint-solid-s.test.mjs:107-116 <-> rules/__tests__/lint-solid-s.test.mjs:187-196
- line 77:1 [clone cluster (32 nodes)] rules/__tests__/lint-solid-s.test.mjs:77-89 <-> rules/__tests__/lint-solid-s.test.mjs:93-105

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-test-disabling-skipping-extended.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 17:1 [clone cluster (24 nodes)] rules/__tests__/lint-test-disabling-skipping-extended.test.mjs:17-19 <-> rules/__tests__/lint-test-disabling-skipping-extended.test.mjs:21-25

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-test-disabling-skipping-ratchet.test.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 135:1 [duplicate code (23 lines)] duplicates rules/__tests__/lint-test-disabling-skipping.test.mjs:475-497. Extract a shared helper instead of copying.
- line 287:1 [duplicate code (8 lines)] duplicates rules/__tests__/lint-test-disabling-skipping-ratchet.test.mjs:258-265. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 49:1 [clone cluster (20 nodes)] rules/__tests__/lint-test-disabling-skipping-ratchet.test.mjs:49-52 <-> rules/__tests__/lint-test-disabling-skipping-ratchet.test.mjs:59-62 <-> rules/__tests__/lint-test-disabling-skipping-ratchet.test.mjs:64-67 <-> rules/__tests__/lint-test-disabling-skipping-ratchet.test.mjs:69-72
- line 90:1 [clone cluster (39 nodes)] rules/__tests__/lint-test-disabling-skipping-ratchet.test.mjs:90-95 <-> rules/__tests__/lint-test-disabling-skipping-ratchet.test.mjs:97-102 <-> rules/__tests__/lint-test-disabling-skipping-ratchet.test.mjs:104-109 <-> rules/__tests__/lint-test-disabling-skipping-ratchet.test.mjs:111-116
- line 118:1 [clone cluster (24 nodes)] rules/__tests__/lint-test-disabling-skipping-ratchet.test.mjs:118-122 <-> rules/__tests__/lint-test-disabling-skipping-ratchet.test.mjs:124-128
- line 190:1 [clone cluster (32 nodes)] rules/__tests__/lint-test-disabling-skipping-ratchet.test.mjs:190-199 <-> rules/__tests__/lint-test-disabling-skipping-ratchet.test.mjs:201-210

## /Users/ryan/Projects/captain-obvious/rules/__tests__/lint-test-disabling-skipping.test.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 37:1 [clone cluster (29 nodes)] rules/__tests__/lint-test-disabling-skipping.test.mjs:37-43 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:45-51 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:53-59 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:163-166 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:168-174 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:176-179 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:181-187 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:189-195 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:205-211 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:229-235 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:237-243 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:245-251 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:316-322 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:324-330 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:332-338 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:392-398
- line 61:1 [clone cluster (31 nodes)] rules/__tests__/lint-test-disabling-skipping.test.mjs:61-67 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:69-75 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:77-80 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:197-203 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:213-219 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:303-306 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:340-346 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:348-354 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:356-362 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:364-370 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:402-408 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:412-418
- line 85:1 [clone cluster (31 nodes)] rules/__tests__/lint-test-disabling-skipping.test.mjs:85-91 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:93-96 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:98-104 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:106-112 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:114-120 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:122-125 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:127-133
- line 145:1 [clone cluster (33 nodes)] rules/__tests__/lint-test-disabling-skipping.test.mjs:145-151 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:153-159
- line 265:1 [clone cluster (31 nodes)] rules/__tests__/lint-test-disabling-skipping.test.mjs:265-268 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:273-276 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:281-284 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:289-292 <-> rules/__tests__/lint-test-disabling-skipping.test.mjs:297-300

## /Users/ryan/Projects/captain-obvious/rules/_kit/check-main-ci-green.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 160:1 [clone cluster (28 nodes)] rules/_kit/check-main-ci-green.mjs:160-163 <-> rules/gov-main-ci-green/check.mjs:13-16 <-> rules/gov-no-push-to-main/check.mjs:53-56 <-> rules/lint-comments/check.mjs:226-229 <-> rules/lint-complexity/check.mjs:11-14 <-> rules/lint-coverage/check.mjs:131-134 <-> rules/lint-dead-code/check.mjs:133-136 <-> rules/lint-dup-fn/check.mjs:108-111 <-> rules/lint-dup-structural/check.mjs:151-154 <-> rules/lint-dup/check.mjs:339-342 <-> rules/lint-emitter-casing/check.mjs:246-249 <-> rules/lint-empty-catch/check.mjs:115-118 <-> rules/lint-empty-tests/check.mjs:85-88 <-> rules/lint-frozen-interfaces/check.mjs:9-12 <-> rules/lint-max-file-lines/check.mjs:53-56 <-> rules/lint-max-line-length/check.mjs:50-53 <-> rules/lint-max-lines/check.mjs:11-14 <-> rules/lint-max-params/check.mjs:11-14 <-> rules/lint-max-statements/check.mjs:11-14 <-> rules/lint-naming/check.mjs:115-118 <-> rules/lint-prettier/check.mjs:154-157 <-> rules/lint-protected-paths/check.mjs:37-40 <-> rules/lint-solid-d/check.mjs:9-12 <-> rules/lint-solid-i/check.mjs:9-12 <-> rules/lint-solid-l/check.mjs:9-12 <-> rules/lint-solid-o/check.mjs:9-12 <-> rules/lint-solid-s/check.mjs:9-12 <-> rules/lint-sync-calls/check.mjs:167-170 <-> rules/lint-test-determinism/check.mjs:93-96 <-> rules/lint-test-disabling-skipping/check.mjs:450-455 <-> rules/lint-tests-with-code/check.mjs:109-112

## /Users/ryan/Projects/captain-obvious/rules/_kit/dup-fn-metrics.mjs

Rule Duplicate functions (lint-dup-fn):
Rule intent: Detects duplicated function bodies (AST clones) in production code.
Violations:
- line 21:1 [duplicate function body (3 sites, 19 nodes, cross-file)] identical α-normalized body: rules/_kit/dup-fn-metrics.mjs:21 toRepoRelative ↔ rules/lint-dup-structural/check.mjs:38 toRepoRelative ↔ rules/lint-dup/check.mjs:56 toRepoRelative. same body reinvented across files — extract a shared helper.

## /Users/ryan/Projects/captain-obvious/rules/_kit/dup-structural-metrics.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 129:1 [clone cluster (24 nodes)] rules/_kit/dup-structural-metrics.mjs:129-132 <-> rules/_kit/frozen-interfaces-metrics.mjs:208-211 <-> rules/_kit/lint-shared.mjs:235-238 <-> rules/_kit/solid-d-metrics.mjs:101-104

## /Users/ryan/Projects/captain-obvious/rules/_kit/fn-metrics.mjs

Rule Duplicate functions (lint-dup-fn):
Rule intent: Detects duplicated function bodies (AST clones) in production code.
Violations:
- line 232:1 [duplicate function body (2 sites, 44 nodes, cross-file)] identical α-normalized body: rules/_kit/fn-metrics.mjs:232 functionsInDiff ↔ rules/_kit/solid-s-metrics.mjs:240 classesInDiff. same body reinvented across files — extract a shared helper.
- line 73:1 [duplicate function body (4 sites, 28 nodes, cross-file)] identical α-normalized body: rules/_kit/fn-metrics.mjs:73 isAnalyzable ↔ rules/_kit/solid-l-metrics.mjs:53 isAnalyzable ↔ rules/_kit/solid-o-metrics.mjs:29 isAnalyzable ↔ rules/_kit/solid-s-metrics.mjs:18 isAnalyzable. same body reinvented across files — extract a shared helper.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 73:1 [clone cluster (28 nodes)] rules/_kit/fn-metrics.mjs:73-77 <-> rules/_kit/solid-l-metrics.mjs:53-57 <-> rules/_kit/solid-o-metrics.mjs:29-33 <-> rules/_kit/solid-s-metrics.mjs:18-22
- line 232:1 [clone cluster (44 nodes)] rules/_kit/fn-metrics.mjs:232-239 <-> rules/_kit/solid-s-metrics.mjs:240-247
- line 233:1 [clone cluster (31 nodes)] rules/_kit/fn-metrics.mjs:233-238 <-> rules/_kit/solid-s-metrics.mjs:241-246

## /Users/ryan/Projects/captain-obvious/rules/_kit/solid-d-metrics.mjs

Rule Duplicate functions (lint-dup-fn):
Rule intent: Detects duplicated function bodies (AST clones) in production code.
Violations:
- line 24:1 [duplicate function body (2 sites, 16 nodes, cross-file)] identical α-normalized body: rules/_kit/solid-d-metrics.mjs:24 isAllowlisted ↔ rules/_kit/solid-i-metrics.mjs:12 isAllowlisted. same body reinvented across files — extract a shared helper.
- line 176:1 [duplicate function body (2 sites, 38 nodes, cross-file)] identical α-normalized body: rules/_kit/solid-d-metrics.mjs:176 runSolidDHook ↔ rules/_kit/solid-i-metrics.mjs:129 runSolidIHook. same body reinvented across files — extract a shared helper.
- line 167:1 [duplicate function body (5 sites, 20 nodes, cross-file)] identical α-normalized body: rules/_kit/solid-d-metrics.mjs:167 usage ↔ rules/_kit/solid-i-metrics.mjs:120 usage ↔ rules/_kit/solid-l-metrics.mjs:130 usage ↔ rules/_kit/solid-o-metrics.mjs:145 usage ↔ rules/_kit/solid-s-metrics.mjs:287 usage. same body reinvented across files — extract a shared helper.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 167:1 [clone cluster (20 nodes)] rules/_kit/solid-d-metrics.mjs:167-174 <-> rules/_kit/solid-i-metrics.mjs:120-127 <-> rules/_kit/solid-l-metrics.mjs:130-137 <-> rules/_kit/solid-o-metrics.mjs:145-152 <-> rules/_kit/solid-s-metrics.mjs:287-294
- line 176:1 [clone cluster (38 nodes)] rules/_kit/solid-d-metrics.mjs:176-184 <-> rules/_kit/solid-i-metrics.mjs:129-137
- line 177:1 [clone cluster (26 nodes)] rules/_kit/solid-d-metrics.mjs:177-183 <-> rules/_kit/solid-i-metrics.mjs:130-136

## /Users/ryan/Projects/captain-obvious/rules/_kit/solid-l-metrics.mjs

Rule Duplicate functions (lint-dup-fn):
Rule intent: Detects duplicated function bodies (AST clones) in production code.
Violations:
- line 125:1 [duplicate function body (2 sites, 27 nodes, cross-file)] identical α-normalized body: rules/_kit/solid-l-metrics.mjs:125 fileLspViolations ↔ rules/_kit/solid-o-metrics.mjs:140 fileOcpViolations. same body reinvented across files — extract a shared helper.
- line 64:1 [duplicate function body (2 sites, 38 nodes, cross-file)] identical α-normalized body: rules/_kit/solid-l-metrics.mjs:64 locOf ↔ rules/_kit/solid-o-metrics.mjs:92 locOf. same body reinvented across files — extract a shared helper.
- line 139:1 [duplicate function body (2 sites, 46 nodes, cross-file)] identical α-normalized body: rules/_kit/solid-l-metrics.mjs:139 runSolidLHook ↔ rules/_kit/solid-o-metrics.mjs:154 runSolidOHook. same body reinvented across files — extract a shared helper.
- line 142:1 [duplicate function body (5 sites, 15 nodes, cross-file)] identical α-normalized body: rules/_kit/solid-l-metrics.mjs:142 collect ↔ rules/_kit/solid-o-metrics.mjs:157 collect ↔ rules/lint-emitter-casing/check.mjs:237 collect ↔ rules/lint-max-file-lines/check.mjs:44 collect ↔ rules/lint-max-line-length/check.mjs:41 collect. same body reinvented across files — extract a shared helper.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 64:1 [clone cluster (38 nodes)] rules/_kit/solid-l-metrics.mjs:64-67 <-> rules/_kit/solid-o-metrics.mjs:92-95
- line 125:1 [clone cluster (27 nodes)] rules/_kit/solid-l-metrics.mjs:125-128 <-> rules/_kit/solid-o-metrics.mjs:140-143
- line 139:1 [clone cluster (46 nodes)] rules/_kit/solid-l-metrics.mjs:139-147 <-> rules/_kit/solid-o-metrics.mjs:154-162
- line 140:1 [clone cluster (34 nodes)] rules/_kit/solid-l-metrics.mjs:140-146 <-> rules/_kit/solid-o-metrics.mjs:155-161 <-> rules/lint-emitter-casing/check.mjs:235-241

## /Users/ryan/Projects/captain-obvious/rules/gov-main-ci-green/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/gov-no-push-to-main/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/gov-require-pr/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-comments/check.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 183:1 [duplicate code (12 lines)] duplicates rules/lint-sync-calls/check.mjs:119-130. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/lint-comments/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-complexity/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 2:1 [clone cluster (72 nodes)] rules/lint-complexity/plugin.mjs:2-40 <-> rules/lint-max-file-lines/plugin.mjs:2-40 <-> rules/lint-max-line-length/plugin.mjs:2-40 <-> rules/lint-max-lines/plugin.mjs:2-40 <-> rules/lint-max-params/plugin.mjs:2-40 <-> rules/lint-max-statements/plugin.mjs:2-40
- line 3:1 [clone cluster (41 nodes)] rules/lint-complexity/plugin.mjs:3-26 <-> rules/lint-max-file-lines/plugin.mjs:3-26 <-> rules/lint-max-line-length/plugin.mjs:3-26 <-> rules/lint-max-lines/plugin.mjs:3-26 <-> rules/lint-max-params/plugin.mjs:3-26 <-> rules/lint-max-statements/plugin.mjs:3-26
- line 27:1 [clone cluster (20 nodes)] rules/lint-complexity/plugin.mjs:27-37 <-> rules/lint-max-file-lines/plugin.mjs:27-37 <-> rules/lint-max-line-length/plugin.mjs:27-37 <-> rules/lint-max-lines/plugin.mjs:27-37 <-> rules/lint-max-params/plugin.mjs:27-37 <-> rules/lint-max-statements/plugin.mjs:27-37

## /Users/ryan/Projects/captain-obvious/rules/lint-coverage/check.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 123:1 [duplicate code (10 lines)] duplicates rules/lint-tests-with-code/check.mjs:101-110. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/lint-coverage/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 2:1 [clone cluster (48 nodes)] rules/lint-coverage/plugin.mjs:2-28 <-> rules/lint-test-disabling-skipping/plugin.mjs:2-28
- line 3:1 [clone cluster (39 nodes)] rules/lint-coverage/plugin.mjs:3-25 <-> rules/lint-dup-fn/plugin.mjs:3-25 <-> rules/lint-dup-structural/plugin.mjs:3-25 <-> rules/lint-dup/plugin.mjs:3-25 <-> rules/lint-test-disabling-skipping/plugin.mjs:3-25

## /Users/ryan/Projects/captain-obvious/rules/lint-dead-code/check.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 68:1 [clone cluster (20 nodes)] rules/lint-dead-code/check.mjs:68-73 <-> rules/lint-prettier/check.mjs:85-90 <-> rules/lint-prettier/check.mjs:123-128

## /Users/ryan/Projects/captain-obvious/rules/lint-dead-code/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 3:1 [clone cluster (38 nodes)] rules/lint-dead-code/plugin.mjs:3-24 <-> rules/lint-emitter-casing/plugin.mjs:3-24 <-> rules/lint-empty-catch/plugin.mjs:3-24 <-> rules/lint-empty-tests/plugin.mjs:3-24 <-> rules/lint-solid-d/plugin.mjs:3-24 <-> rules/lint-solid-i/plugin.mjs:3-24 <-> rules/lint-solid-l/plugin.mjs:3-24 <-> rules/lint-solid-o/plugin.mjs:3-24 <-> rules/lint-sync-calls/plugin.mjs:3-24 <-> rules/lint-test-determinism/plugin.mjs:3-24

## /Users/ryan/Projects/captain-obvious/rules/lint-dup-fn/check.mjs

Rule Duplicate functions (lint-dup-fn):
Rule intent: Detects duplicated function bodies (AST clones) in production code.
Violations:
- line 95:1 [duplicate function body (2 sites, 26 nodes, cross-file)] identical α-normalized body: rules/lint-dup-fn/check.mjs:95 main ↔ rules/lint-dup-structural/check.mjs:138 main. same body reinvented across files — extract a shared helper.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 62:1 [clone cluster (27 nodes)] rules/lint-dup-fn/check.mjs:62-68 <-> rules/lint-dup-structural/check.mjs:65-71
- line 95:1 [clone cluster (26 nodes)] rules/lint-dup-fn/check.mjs:95-104 <-> rules/lint-dup-structural/check.mjs:138-147

## /Users/ryan/Projects/captain-obvious/rules/lint-dup-fn/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 7:1 [duplicate code (27 lines)] duplicates rules/lint-dup-structural/plugin.mjs:7-33. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 2:1 [clone cluster (55 nodes)] rules/lint-dup-fn/plugin.mjs:2-33 <-> rules/lint-dup-structural/plugin.mjs:2-33 <-> rules/lint-dup/plugin.mjs:2-33

## /Users/ryan/Projects/captain-obvious/rules/lint-dup-structural/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-dup/check.mjs

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 124:1 [clone cluster (25 nodes)] rules/lint-dup/check.mjs:124-128 <-> rules/lint-dup/check.mjs:129-133

## /Users/ryan/Projects/captain-obvious/rules/lint-dup/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 7:1 [duplicate code (27 lines)] duplicates rules/lint-dup-structural/plugin.mjs:7-33. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/lint-emitter-casing/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 7:1 [duplicate code (21 lines)] duplicates rules/lint-test-determinism/plugin.mjs:7-27. Extract a shared helper instead of copying.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 2:1 [clone cluster (47 nodes)] rules/lint-emitter-casing/plugin.mjs:2-27 <-> rules/lint-empty-catch/plugin.mjs:2-27 <-> rules/lint-empty-tests/plugin.mjs:2-27 <-> rules/lint-solid-d/plugin.mjs:2-27 <-> rules/lint-solid-i/plugin.mjs:2-27 <-> rules/lint-solid-l/plugin.mjs:2-27 <-> rules/lint-solid-o/plugin.mjs:2-27 <-> rules/lint-sync-calls/plugin.mjs:2-27 <-> rules/lint-test-determinism/plugin.mjs:2-27

## /Users/ryan/Projects/captain-obvious/rules/lint-empty-catch/check.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 60:1 [duplicate code (9 lines)] duplicates rules/lint-test-disabling-skipping/check.mjs:311-319. Extract a shared helper instead of copying.
- line 63:1 [duplicate code (11 lines)] duplicates rules/lint-sync-calls/check.mjs:122-132. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/lint-empty-catch/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 7:1 [duplicate code (21 lines)] duplicates rules/lint-test-determinism/plugin.mjs:7-27. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/lint-empty-tests/check.mjs

Rule Duplicate functions (lint-dup-fn):
Rule intent: Detects duplicated function bodies (AST clones) in production code.
Violations:
- line 19:1 [duplicate function body (2 sites, 16 nodes, cross-file)] identical α-normalized body: rules/lint-empty-tests/check.mjs:19 isTestFile ↔ rules/lint-test-determinism/check.mjs:51 isTestFile. same body reinvented across files — extract a shared helper.
- line 75:1 [duplicate function body (2 sites, 16 nodes, cross-file)] identical α-normalized body: rules/lint-empty-tests/check.mjs:75 collect ↔ rules/lint-test-determinism/check.mjs:83 collect. same body reinvented across files — extract a shared helper.
- line 72:1 [duplicate function body (2 sites, 45 nodes, cross-file)] identical α-normalized body: rules/lint-empty-tests/check.mjs:72 main ↔ rules/lint-test-determinism/check.mjs:80 main. same body reinvented across files — extract a shared helper.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 72:1 [clone cluster (45 nodes)] rules/lint-empty-tests/check.mjs:72-81 <-> rules/lint-test-determinism/check.mjs:80-89
- line 73:1 [clone cluster (35 nodes)] rules/lint-empty-tests/check.mjs:73-80 <-> rules/lint-test-determinism/check.mjs:81-88

## /Users/ryan/Projects/captain-obvious/rules/lint-empty-tests/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 7:1 [duplicate code (21 lines)] duplicates rules/lint-test-determinism/plugin.mjs:7-27. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/lint-frozen-interfaces/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-max-file-lines/check.mjs

Rule Duplicate functions (lint-dup-fn):
Rule intent: Detects duplicated function bodies (AST clones) in production code.
Violations:
- line 41:1 [duplicate function body (2 sites, 47 nodes, cross-file)] identical α-normalized body: rules/lint-max-file-lines/check.mjs:41 main ↔ rules/lint-max-line-length/check.mjs:38 main. same body reinvented across files — extract a shared helper.

Rule Structural duplication (lint-dup-structural):
Rule intent: Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.
Violations:
- line 41:1 [clone cluster (47 nodes)] rules/lint-max-file-lines/check.mjs:41-49 <-> rules/lint-max-line-length/check.mjs:38-46
- line 42:1 [clone cluster (37 nodes)] rules/lint-max-file-lines/check.mjs:42-48 <-> rules/lint-max-line-length/check.mjs:39-45

## /Users/ryan/Projects/captain-obvious/rules/lint-max-file-lines/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-max-line-length/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-max-lines/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-max-params/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-max-statements/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-naming/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-prettier/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-protected-paths/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-solid-d/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 7:1 [duplicate code (21 lines)] duplicates rules/lint-test-determinism/plugin.mjs:7-27. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/lint-solid-i/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 7:1 [duplicate code (21 lines)] duplicates rules/lint-test-determinism/plugin.mjs:7-27. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/lint-solid-l/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 7:1 [duplicate code (21 lines)] duplicates rules/lint-test-determinism/plugin.mjs:7-27. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/lint-solid-o/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 7:1 [duplicate code (21 lines)] duplicates rules/lint-test-determinism/plugin.mjs:7-27. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/lint-solid-s/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-sync-calls/check.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 106:1 [duplicate code (7 lines)] duplicates rules/lint-test-disabling-skipping/check.mjs:250-253. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/lint-sync-calls/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 7:1 [duplicate code (21 lines)] duplicates rules/lint-test-determinism/plugin.mjs:7-27. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/lint-test-determinism/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-test-disabling-skipping/check.mjs

Rule Token duplication (lint-dup):
Rule intent: Detects token-based copy-paste clones across the repo (jscpd).
Violations:
- line 328:1 [duplicate code (10 lines)] duplicates rules/lint-tests-with-code/check.mjs:58-67. Extract a shared helper instead of copying.

## /Users/ryan/Projects/captain-obvious/rules/lint-test-disabling-skipping/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/rules/lint-tests-with-code/plugin.mjs

Rule Dead code (lint-dead-code):
Rule intent: Detects unused files, exports, and enum members (knip).
Violations:
- line 2:16 [unused export `default`] nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.

## /Users/ryan/Projects/captain-obvious/src/db/__tests__/audit.test.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 172:21 [sync call] mkdtempSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 179:7 [sync call] rmSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 186:17 [sync call] mkdtempSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 197:7 [sync call] rmSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

Rule Test determinism (lint-test-determinism):
Rule intent: Flags nondeterministic sources in tests — Date.now/new Date()/performance.now, Math.random, and real network (fetch/XMLHttpRequest).
Violations:
- line 105:18 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 127:18 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.

## /Users/ryan/Projects/captain-obvious/src/db/__tests__/location.test.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 27:15 [sync call] mkdtempSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 30:5 [sync call] writeFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 41:23 [sync call] rmSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 52:3 [sync call] mkdirSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

## /Users/ryan/Projects/captain-obvious/src/db/__tests__/open.test.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 43:21 [sync call] mkdtempSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 50:7 [sync call] rmSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 66:11 [sync call] mkdtempSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 71:5 [sync call] rmSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

## /Users/ryan/Projects/captain-obvious/src/db/audit.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 37:5 [sync call] mkdirSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 40:11 [sync call] readFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

## /Users/ryan/Projects/captain-obvious/src/db/location.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 31:9 [sync call] existsSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 40:8 [sync call] existsSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 41:29 [sync call] readFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

## /Users/ryan/Projects/captain-obvious/src/db/open.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 58:5 [sync call] mkdirSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 62:11 [sync call] readFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

Rule Max parameters per function (lint-max-params):
Rule intent: Flags functions with more than the allowed number of parameters.
Violations:
- line 74:1 [max-params] fn "migrateColumn" has 4 parameters (limit 3)

## /Users/ryan/Projects/captain-obvious/src/db/projects.ts

Rule Max parameters per function (lint-max-params):
Rule intent: Flags functions with more than the allowed number of parameters.
Violations:
- line 186:1 [max-params] fn "setProjectRuleAction" has 4 parameters (limit 3)
- line 206:1 [max-params] fn "removeProjectRuleAction" has 4 parameters (limit 3)
- line 233:1 [max-params] fn "setProjectRule" has 4 parameters (limit 3)

## /Users/ryan/Projects/captain-obvious/src/db/rules.ts

Rule Max statements per function (lint-max-statements):
Rule intent: Flags functions with more than the allowed number of statements.
Violations:
- line 140:32 [max-statements] fn (anonymous) has 27 statements (limit 20)

## /Users/ryan/Projects/captain-obvious/src/rules/__tests__/dispatch-activity-coverage.test.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 66:12 [sync call] mkdtempSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 88:3 [sync call] rmSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

## /Users/ryan/Projects/captain-obvious/src/rules/__tests__/dispatch-audit.test.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 28:14 [sync call] existsSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

## /Users/ryan/Projects/captain-obvious/src/rules/__tests__/dispatch-integration.test.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 36:11 [sync call] mkdtempSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 61:3 [sync call] rmSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

## /Users/ryan/Projects/captain-obvious/src/rules/__tests__/dispatch-runner.test.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 68:12 [sync call] mkdtempSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 91:3 [sync call] rmSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

## /Users/ryan/Projects/captain-obvious/src/rules/__tests__/protectedPaths.test.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 39:11 [sync call] mkdtempSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 45:5 [sync call] rmSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

## /Users/ryan/Projects/captain-obvious/src/rules/depProbe.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 23:10 [sync call] spawnSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

## /Users/ryan/Projects/captain-obvious/src/rules/load.ts

Rule Max statements per function (lint-max-statements):
Rule intent: Flags functions with more than the allowed number of statements.
Violations:
- line 57:1 [max-statements] fn "loadPlugins" has 23 statements (limit 20)

## /Users/ryan/Projects/captain-obvious/src/server/__tests__/activity.test.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 70:9 [sync call] mkdtempSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 77:3 [sync call] rmSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

Rule Test determinism (lint-test-determinism):
Rule intent: Flags nondeterministic sources in tests — Date.now/new Date()/performance.now, Math.random, and real network (fetch/XMLHttpRequest).
Violations:
- line 91:17 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 112:17 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 124:17 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 135:17 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 147:57 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 155:17 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 175:17 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 186:17 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 203:17 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 219:17 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 231:17 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 243:17 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 253:17 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.

## /Users/ryan/Projects/captain-obvious/src/server/__tests__/analyze.test.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 14:10 [sync call] mkdtempSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 20:3 [sync call] rmSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 25:3 [sync call] mkdirSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 26:3 [sync call] writeFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

## /Users/ryan/Projects/captain-obvious/src/server/__tests__/fix.test.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 77:9 [sync call] mkdtempSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 79:3 [sync call] writeFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 87:3 [sync call] rmSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 242:12 [sync call] existsSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 259:12 [sync call] existsSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 260:12 [sync call] readFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 301:12 [sync call] readFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 437:5 [sync call] writeFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 444:12 [sync call] readFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 470:12 [sync call] existsSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 506:5 [sync call] writeFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 539:12 [sync call] readFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

## /Users/ryan/Projects/captain-obvious/src/server/__tests__/panelExt.dom.test.ts

Rule Empty tests (lint-empty-tests):
Rule intent: Flags it()/test() with no callback or no assertion (expect/assert) — tests that pass vacuously.
Violations:
- line 197:68 [test-no-body] it()/test() has no callback — a pending stub asserts nothing.

## /Users/ryan/Projects/captain-obvious/src/server/__tests__/profiling.test.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 60:9 [sync call] mkdtempSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 65:3 [sync call] rmSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

Rule Test determinism (lint-test-determinism):
Rule intent: Flags nondeterministic sources in tests — Date.now/new Date()/performance.now, Math.random, and real network (fetch/XMLHttpRequest).
Violations:
- line 44:35 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 125:17 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 136:17 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 148:29 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.
- line 210:21 [date-now] Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.

## /Users/ryan/Projects/captain-obvious/src/server/__tests__/run.test.ts

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 52:9 [sync call] mkdtempSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 53:3 [sync call] mkdirSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 54:3 [sync call] mkdirSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 55:3 [sync call] mkdirSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 57:3 [sync call] writeFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 58:3 [sync call] writeFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 76:3 [sync call] rmSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

## /Users/ryan/Projects/captain-obvious/src/server/activity.ts

Rule Max statements per function (lint-max-statements):
Rule intent: Flags functions with more than the allowed number of statements.
Violations:
- line 132:1 [max-statements] fn "activitySummary" has 25 statements (limit 20)

## /Users/ryan/Projects/captain-obvious/src/server/fix.ts

Rule Max parameters per function (lint-max-params):
Rule intent: Flags functions with more than the allowed number of parameters.
Violations:
- line 101:1 [max-params] fn "runScriptFix" has 4 parameters (limit 3)
- line 198:1 [max-params] fn "buildAgentFixPrompt" has 4 parameters (limit 3)

Rule Max statements per function (lint-max-statements):
Rule intent: Flags functions with more than the allowed number of statements.
Violations:
- line 437:1 [max-statements] fn "collectRunViolationsByFile" has 24 statements (limit 20)

## /Users/ryan/Projects/captain-obvious/src/server/profiling.ts

Rule Max lines per function (lint-max-lines):
Rule intent: Flags functions longer than the line limit.
Violations:
- line 71:1 [max-lines] fn "profilingReport" has 93 lines (limit 60)

Rule Max statements per function (lint-max-statements):
Rule intent: Flags functions with more than the allowed number of statements.
Violations:
- line 71:1 [max-statements] fn "profilingReport" has 42 statements (limit 20)

## /Users/ryan/Projects/captain-obvious/src/server/registry.ts

Rule Max lines per function (lint-max-lines):
Rule intent: Flags functions longer than the line limit.
Violations:
- line 123:1 [max-lines] fn "listRules" has 109 lines (limit 60)
- line 509:1 [max-lines] fn "listProjectRules" has 68 lines (limit 60)

Rule Max parameters per function (lint-max-params):
Rule intent: Flags functions with more than the allowed number of parameters.
Violations:
- line 606:1 [max-params] fn "patchProjectRule" has 4 parameters (limit 3)

Rule Max statements per function (lint-max-statements):
Rule intent: Flags functions with more than the allowed number of statements.
Violations:
- line 123:1 [max-statements] fn "listRules" has 34 statements (limit 20)
- line 392:1 [max-statements] fn "patchRule" has 28 statements (limit 20)

## /Users/ryan/Projects/captain-obvious/src/server/serve.ts

Rule Cyclomatic complexity (lint-complexity):
Rule intent: Flags functions whose cyclomatic complexity exceeds the limit.
Violations:
- line 173:1 [complexity] fn "handle" has 78 cyclomatic complexity (limit 15)

Rule Synchronous I/O calls (lint-sync-calls):
Rule intent: Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.
Violations:
- line 87:7 [sync call] existsSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 88:28 [sync call] readFileSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 108:61 [sync call] existsSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 306:10 [sync call] existsSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 312:10 [sync call] existsSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 328:7 [sync call] existsSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).
- line 339:7 [sync call] existsSync() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).

Rule Max lines per function (lint-max-lines):
Rule intent: Flags functions longer than the line limit.
Violations:
- line 173:1 [max-lines] fn "handle" has 160 lines (limit 60)

Rule Max parameters per function (lint-max-params):
Rule intent: Flags functions with more than the allowed number of parameters.
Violations:
- line 173:1 [max-params] fn "handle" has 5 parameters (limit 3)

Rule Max statements per function (lint-max-statements):
Rule intent: Flags functions with more than the allowed number of statements.
Violations:
- line 173:1 [max-statements] fn "handle" has 97 statements (limit 20)

