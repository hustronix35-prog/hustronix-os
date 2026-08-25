# Talk V2 — Founder usability test

**Purpose:** Prove whether a real person can use Hustronix for ~30 minutes without product explanation.  
**Do not** optimize for score. Optimize for whether they get stuck.

## Setup

1. Fresh tenant (new signup / dedicated test user).
2. Seed realistic company data if the Brain is empty (customers, signals, situations, optional decisions) — enough that company questions have *something* true to say.
3. Open Talk only. No walkthrough of modes, chips, Situation, Decision OS, or Company Brain.
4. One observer silent. One tester. Screen + notes.

## Script for the tester (read aloud once)

> Use Hustronix to understand and think through this company. Ask it anything you want.

Then stop talking.

## What “success” looks like (observe, don’t coach)

They should *naturally* try some mix of:

- greeting / orientation  
- learn something general  
- ask about the company  
- follow-up (“why?”, “what evidence?”)  
- switch topic  
- brainstorm  
- challenge an answer  
- ask for a recommendation  
- ask about a customer / sales / what changed  
- eventually try an action (“let’s do X”)

They do **not** need to hit every bullet. They need to stay oriented without asking *you* what to do.

## Observation log (copy per session)

| # | Timestamp | What they said / did | Confusion? (Y/N) | Failure class | Notes |
|---|-----------|----------------------|------------------|---------------|-------|
| 1 | | | | | |

### Failure classes (pick one)

| Class | Use when |
|-------|----------|
| `UX FAILURE` | “What am I supposed to do here?” / stuck UI / unclear next step |
| `FACTUALITY FAILURE` | Unsupported company claim |
| `RETRIEVAL FAILURE` | Relevant Brain data existed; answer ignored it or dumped wrong slice |
| `REASONING FAILURE` | Context was right; judgment weak / generic |
| `INTELLIGENCE LIMITATION` | Honest missing data / thin Brain |
| `EXPECTED BEHAVIOR` | Governance block, clarify question, etc. |
| `REAL PRODUCT BUG` | Crash, wrong tenant, broken composer |

## End-of-session questions (only after 30 min)

1. Did you feel you were talking to something that understands this company?  
2. Where did you get confused?  
3. What did you want to ask that you couldn’t?  
4. Would you use this again next week?

## Pass / fail (judgment call)

| Result | Criterion |
|--------|-----------|
| **Pass** | ~30 min without needing an explanation; mostly useful answers; confusion moments rare and recoverable |
| **Soft fail** | Usable with occasional “what do I do?” — fix UX copy / empty states |
| **Hard fail** | Needs constant guidance, or frequent unsupported claims |

## After the session

1. Paste the log into `docs/qa/talk-v2-founder-session-<date>.md`.  
2. For each failure, look up `GET /api/intelligence/talk/traces` (or response `trace`) for that turn.  
3. Classify: retrieval wrong vs reasoning weak vs Brain thin.  
4. **Do not** add Talk modes. Fix the class of failure (Brain depth, copy, retrieval ranking, etc.).

## Architecture freeze reminder

Talk V2 pipeline stays frozen. Improvements come from founder failures + Brain depth, not new conversation architecture.
