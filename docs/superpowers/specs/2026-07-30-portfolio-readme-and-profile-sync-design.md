# StudyTube Portfolio README and Profile Sync Design

## Status

- Approved direction: evidence-first case study
- Canonical narrative: repository `README.md`
- Canonical dynamic facts: `docs/evidence/portfolio/facts.json`
- Sync targets: Notion, blog, Google Docs resume, Wanted resume
- Excluded path: `docs/presentation`

## Why this needs a design

StudyTube already has more implementation detail than a recruiter can reasonably read in one pass. The remaining problem is not a lack of material. It is deciding which facts deserve the first screen, how to distinguish verified outcomes from goals, and how to keep the same project story consistent across five surfaces with different reading lengths.

The README should answer these questions in order:

1. What learning problem did the project start from?
2. Which concurrency and ownership failure modes were found in code review and reproduced by tests?
3. Which engineering choices changed the system, and what did each choice cost?
4. What has actually been verified in CI or production?
5. What is still limited or awaiting an external approval?

## Chosen approach

Use the repository README as an evidence-first case study. The product intent and implemented flow remain visible, but the main narrative follows problem, failed assumptions, decisions, verification, and remaining limits.

Two alternatives were considered:

- A product-first landing page would make the feature set easy to scan, but would hide the strongest backend and reliability work below the fold.
- A technical dossier would maximize detail, but would read like generated documentation and make the user's contribution difficult to identify quickly.

The evidence-first approach best fits a backend portfolio because every strong statement can lead to a specific implementation, test, workflow run, or live observation.

## Reader and success criteria

The primary reader is a working engineer or recruiter who spends roughly one minute deciding whether to inspect the repository further. A successful README lets that reader find the following without guessing:

- one clear sentence defining the product problem;
- the user's role and the scope of the redesign;
- four or five decisions with an explicit reason and tradeoff;
- verified results with dates and evidence links;
- a truthful production status and cost boundary;
- the largest remaining operational limitation.

The writing should sound like a developer explaining work they understand. Short factual sentences, specific failure cases, and restrained claims take priority over slogans and exhaustive technology lists.

## Narrative structure

### Opening

Start with the product premise and the current service link. Do not present the premise as user research unless research evidence exists. State production status in plain language. Keep the screenshot, but label local demo data clearly until a sanitized production capture exists.

### Problem and redesign

Explain that the initial URL-and-array model was sufficient for a screen prototype but failed to preserve ordering, ownership, snapshots, and work intent. Group the redesign around four consistency boundaries rather than presenting a feature inventory.

### Selected decisions

Keep the existing strongest decisions and make the choice logic easy to scan:

- server-revocable sessions instead of browser-trusted auth state;
- a Course aggregate instead of playlist ID arrays;
- a transactional outbox instead of direct follow-up execution;
- authorization-aware hybrid retrieval instead of vector-only lookup;
- immutable, resumable release activation instead of editing a live checkout.

Each decision follows the same small pattern: discovered failure mode, selected design, reason, cost, and evidence. Use observed failure only for a dated production incident. Use test-reproduced race or code-review finding for pre-production evidence.

### Outcomes

Separate outcomes by evidence class:

- CI-verified: exact suite and test counts, builds, lint, deployment contracts, secret scans, and dependency audit results tied to a commit or workflow run;
- production-verified: DNS, TLS, health, browser flow, cookie boundary, worker email path, recovery behavior, and infrastructure settings observed on AWS;
- not yet proven: load, RPO/RTO, SES production access, availability, and external model quality.

Do not combine local test counts with production reliability claims. Do not turn a configured threshold into a measured outcome.

## Evidence hard gate

External synchronization starts only when all of these conditions hold for one evidence subject commit:

- every required CI job completed successfully for the commit;
- the deploy job completed successfully for the same commit;
- production DNS, TLS, health, browser, cookie, service, and infrastructure checks have sanitized evidence records;
- every fact intended for synchronization is either verified or explicitly marked pending.

If any condition fails, README and external surfaces keep production results pending. A later documentation commit does not become the evidence subject. Record `evidenceSubjectSha` for the code and deployment under test and `documentationSha` for the commit that publishes the resulting facts.

### Operating constraints

Explain the single-instance AWS choice as a student-budget tradeoff. Include the annual domain price and recurring infrastructure estimate only with their dates and assumptions. Name the loss of high availability and managed database recovery directly.

## Evidence rules

Every numerical claim needs a reproducible source. The source can be a GitHub Actions run, test command, sanitized AWS observation record, or committed evidence file. Dynamic claims include an observed date and an expiry date. Console screenshots and exports must remove account, instance, contact, token, and secret material before they become evidence.

Use these wording rules:

- passed locally or passed in CI describes automated verification;
- observed in production describes a live check;
- designed to or target describes an unmeasured contract;
- pending describes an external approval or unfinished live proof.

Secrets, AWS account identifiers, instance identifiers, verification links, and session material never appear in the README, fact sheet, logs, screenshots, or synchronized StudyTube sections. Existing contact fields in Google Docs and Wanted are outside the read and write scope and must be preserved without copying them into project evidence.

## Structured fact sheet

Create the machine-readable fact sheet at `docs/evidence/portfolio/facts.json` before changing the README. Each fact has these fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier used across every surface |
| `value` | Exact text or number allowed to be copied |
| `status` | `ci_verified`, `production_verified`, or `pending` |
| `observedAt` | UTC timestamp of the supporting observation |
| `expiresAt` | Date after which the fact must be rechecked |
| `evidenceSubjectSha` | Code and deployment commit being described |
| `documentationSha` | Documentation commit that publishes the fact; null before that commit exists |
| `workflowRun` | Public run URL and attempt when CI supplies the evidence |
| `publicEvidence` | Sanitized committed path or public URL |
| `evidenceHash` | SHA-256 of non-public raw evidence when only integrity may be recorded |

Test counts come from the named workflow job and step, not from a manually copied total. Cost facts additionally name every AWS resource assumption, pricing source, pricing date, tax and free-tier treatment, and monthly or annual unit.

## Cross-surface content model

The fact sheet is the source of truth for dynamic values and evidence status. The README is the canonical human narrative. Other surfaces adapt the README's length and emphasis without inventing different metrics.

| Surface | Purpose | Content shape |
| --- | --- | --- |
| README | Evidence and technical depth | Full case study, links, commands, current limits |
| Notion | Interview-ready project record | Expanded decision diary and diagrams using the same facts |
| Blog | Human narrative | Initial failure, turning point, selected decisions, lessons |
| Google Docs resume | Recruiter scan | Three to five accomplishment bullets with evidence |
| Wanted resume | Short profile | Two or three compact impact bullets and repository link |

All surfaces use the same fact IDs for project name, service URL, repository URL, production status, dates, test results, and cost assumptions. If a live fact changes, update the fact sheet and README first and then propagate it. Mark a surface stale when any copied fact passes `expiresAt` or its fact-sheet hash no longer matches.

## External write allowlist and state

Before editing an external surface, keep a session-local allowlist containing its account label, exact document or post ID, StudyTube section boundary, current public or draft state, and a sanitized snapshot hash. Target identifiers and account labels are not committed or copied into logs. Do not read or change content outside the named section. The allowlist is assembled from the user's already-open authenticated tabs; authentication itself remains manual.

Prepare a before-and-after preview for every public target and request one bundled approval immediately before applying public changes. This single approval covers the reviewed Notion, blog, Google Docs, and Wanted diffs. Draft-only saves may be prepared earlier but are not published.

Track each target through this state machine:

`discovered → snapshotted → previewed → approved → applied → verified`

A target may move from `applied` to `failed` or `rolled_back`. Store the pre-write snapshot hash and the intended fact-sheet hash so a retry is idempotent. If only some targets succeed, freeze the fact sheet, report the exact state of every target, and roll forward the remaining approved diffs. Roll back only when the application supports a verified restoration of the captured prior content.

## Synchronization workflow

1. Finish CI and production verification for one evidence subject commit.
2. Generate and validate the structured fact sheet from the resulting evidence.
3. Update the README from the fact sheet and record the documentation commit separately.
4. Discover and snapshot the exact Notion, blog, Google Docs, and Wanted StudyTube sections without collecting unrelated personal content.
5. Produce sanitized before-and-after previews and obtain one bundled approval for every public change.
6. Apply approved updates with the target state machine and verify the resulting content.
7. Compare fact IDs, values, dates, URLs, status, and fact-sheet hash across all surfaces.

Authentication screens remain manual. External publication preserves an existing draft/publication state until the bundled public-change approval. A new public post always requires its target and final preview to be present in that approval.

## Boundaries

- Do not edit `docs/presentation`.
- Do not claim SES production delivery before AWS grants access and a live delivery succeeds.
- Do not call an empty-database restore rehearsal a production RTO result.
- Do not expose operational identifiers or secret values in screenshots or text.
- Do not replace personal resume or blog content outside the StudyTube section.
- Do not use decorative claims such as production-ready unless the described boundary is named and verified.
- Do not treat an AWS console observation as public evidence until it is sanitized and represented by a committed record or integrity hash.

## Acceptance checks

- README headings for problem, decisions, verified results, operating constraints, and limitations are present and linked from the table of contents when one is used.
- Every outcome maps to a fact-sheet ID labeled `ci_verified`, `production_verified`, or `pending`.
- Test counts, evidence subject SHA, workflow run, attempt, job, and step match the fact sheet exactly.
- A clean browser receives the expected HTTPS status, valid hostname certificate, health response, and security-cookie behavior recorded in the production evidence checklist.
- Every cost value has a pricing date, resource quantity, unit price source, monthly or annual unit, and free-tier assumption.
- Every external target reaches `verified`, or the final state report names it as `failed` or `rolled_back` without claiming synchronization complete.
- Post-write snapshots contain the same required fact IDs and values as the locked fact-sheet hash.
- `docs/presentation` has no diff.
