# Limitation Probes

## 1 — Dependency chain (Eng → Security → Legal)

| from | to | status |
|---|---|---|
| engineering | security | AT_RISK |
| security | legal | DELAYED |
| engineering | security | AT_RISK |
| engineering | security | AT_RISK |
| security | legal | DELAYED |
| engineering | security | AT_RISK |

**Talk bottleneck answer:** Nothing material is forming on the situation ledger yet. New signals will show up here as they connect.

**Assessment:** Direction partially inferred

## 2 — Parallel Acme stories (churn vs implementation vs security)

Situations for Acme: **2**

- `customer_churn_risk` · Customer renewal / churn risk — Acme · stage=DECIDED · evidence=4
- `emergent:customer_health::acme` · Acme: customer health · stage=ELEVATED · evidence=3

### Customer renewal / churn risk — Acme
- Acme renewal conversation isn't going well — sponsor stopped responding.
- Acme exec escalation: implementation delay driving renewal risk.
- Acme support escalations spiking; customer evaluating an alternative vendor.
- Acme implementation milestone slipped two weeks — connector still unstable.

### Acme: customer health
- Acme renewal conversation isn't going well — sponsor stopped responding.
- Acme support escalations spiking; customer evaluating an alternative vendor.
- Acme exec escalation: implementation delay driving renewal risk.

**Assessment:** Multiple situations kept separate

