# Talk V2.2 — Founder Validation Protocol

**Purpose:** Prove whether a real founder can use Hustronix for ~30 minutes **without** product explanation.

Talk V2.1 architecture is **frozen** for this session. Do not patch Talk during the session.

---

## Operator setup (before the founder arrives)

```bash
npm run founder:validation
```

Copy the printed `username` / `password` / `session_id`.

1. Start API + os-ui as usual.
2. Log out of any other account.
3. Log in as the printed founder user.
4. Open **Talk** only.
5. Open observer log: `docs/qa/founder-validation-observer-log.md`

---

## Founder instruction (read aloud once — then stop talking)

> **Use Hustronix for 30 minutes. Figure out what's happening in this company, explore anything you're curious about, and see if you can use it to decide what to do.**

Do **not** give:

- suggested questions
- a product tour
- Talk vocabulary
- Company Brain / Situation / Decision explanations
- example commands

If they ask “What should I ask?”, record **HELP_REQUIRED** and do **not** answer.

---

## After ~30 minutes — trust interview

Record exact answers:

1. What do you think Hustronix does?
2. What was the first useful thing it showed you?
3. What confused you?
4. Did you trust its answers?
5. Did it show you anything you didn't already know?
6. What would you use it for every week?
7. Would you connect your company's data?
8. What would stop you from connecting it?
9. Would you pay for this?
10. What would make it indispensable?

---

## Export

```bash
npm run export:founder-session -- <session-id>
```

Report lands in:

`docs/qa/founder-validation/<session-id>-report.md`

---

## Pass criteria (human judgment)

- Started without explanation
- Discovered company state naturally
- Could investigate a customer, ask why / what else, brainstorm, get a recommendation
- Could switch topics without contamination
- Understood evidence without internal jargon
- Distinguished facts from recommendations
- Reached governed action when appropriate (or understood a legitimate block)
- No fabricated company facts
- No cross-tenant leakage
- No governance bypass
- **Zero builder interventions** for a clean PASS

A high automated score with coaching is **not** a pass.
