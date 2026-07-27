// Governance rule runner: block work while main CI is red. The logic lives in
// check-main-ci-green.mjs; this slug-named module exists so defineRule().run can
// resolve the rule by its registry slug (hooks/git/<slug>.mjs).
export { main } from "./check-main-ci-green.mjs";
