# ADR 0002: Issue Creation Policy for Scope Violations

**Status:** Accepted
**Date:** 2026-05-30
**Context:** [WORKPAC-583](https://linear.app/workpacker/issue/WORKPAC-583)

## Context
Automated PR review systems must handle scope violations predictably. The goal is to avoid flooding Linear with noise while ensuring actionable scope issues are captured effectively.

## Decision
We will adopt the following rules for PR review follow-up:

### 1. Decision Matrix
| Result | Default Behavior |
| :--- | :--- |
| `Accept` | Review-only |
| `Caution` | Review-only |
| `Split required` | Create or update issue |
| `Out of scope` | Create or update issue |

### 2. Issue Creation/Update Rules
#### Create a new issue when all are true:
- Point to concrete follow-up work.
- Work is not already tracked.
- Substantial enough to outlive the current PR.
- Expected action is execution, not just awareness.

#### Update an existing issue when:
- It maps to existing work.
- PR adds evidence/urgency to known gaps.
- It belongs to the same project lane.

#### Stay review-only when:
- Finding is advisory.
- Concern is minor/resolvable directly in PR.
- Finding is cautionary context.

### 3. Anti-Noise Rules
- One well-scoped issue is better than multiple fragments.
- If the answer is "remove this from the PR," do not create an issue.
- Bias toward fewer, durable follow-up issues.
- Do not duplicate; deduplicate aggressively.

## Acceptance Criteria for Automation
- Automated systems must distinguish between `create-new`, `update-existing`, and `review-only`.
- `Caution` findings must NOT automatically create issues.
- Findings requiring follow-up (e.g., `Split required`) must result in durable tracking.
- Automation must actively search for existing, related issues before creation.

## Consequences
- **Positive:** Improved signal-to-noise ratio in Linear, clearer accountability for follow-up work.
- **Negative:** Requires initial investment in deduplication logic for automation.
