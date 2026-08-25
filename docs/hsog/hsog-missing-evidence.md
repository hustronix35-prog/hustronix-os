MISSING EVIDENCE INVESTIGATION
────────────────────────────
Do not force-attach. Architectural = gate/entity miss. Off-facet = probably should stay unattached.
### SignalGrid ingestion outage (infrastructure_outage) — attached 86% · missing 2/14
Classes: architectural=2 off-facet=0 ambiguous=0
- d82 [architectural] hustronix_infrastructure_outage_d82_customer_commitment_made__crm_record: Shares entity [Acme] but no facet/keyword — attach gate requires facet or keyword with entity.
  “[hubspot:deal.propertyChange] objectId=acme_industrials {"notes":"CRM update (Jordan): Acme imports a larger telemetry dataset than forecast”
- d82 [architectural] hustronix_infrastructure_outage_d82_customer_commitment_made__metric_snapshot: Shares entity [Acme] but no facet/keyword — attach gate requires facet or keyword with entity.
  “Metrics snapshot: Acme imports a larger telemetry dataset than forecast.”
### Support access exception SEV1 (security_incident) — attached 88% · missing 2/17
Classes: architectural=0 off-facet=2 ambiguous=0
- d66 [off_facet] hustronix_security_incident_d66_risk_accepted__slack_message: No keyword hit, no pattern facet, no shared primary entity. Likely off-facet / ambient relative to the situation.
  “[Message] channel=engineering user=ethan Ethan in #engineering: Engineering says exception is needed for Acme debugging. (cc Jordan)”
- d66 [off_facet] hustronix_security_incident_d66_risk_accepted__jira_issue: No keyword hit, no pattern facet, no shared primary entity. Likely off-facet / ambient relative to the situation.
  “[jira:jira:issue_updated] OPS-985 status=In Progress assignee=ethan@example.com Jira: Engineering says exception is needed for Acme debuggin”
### FlowOps permission regression (feature_quality_regression) — attached 86% · missing 2/14
Classes: architectural=0 off-facet=2 ambiguous=0
- d77 [off_facet] hustronix_feature_quality_regression_d77_scope_changed__confluence_page: No keyword hit, no pattern facet, no shared primary entity. Likely off-facet / ambient relative to the situation.
  “Doc update by Samira: Product accepts limited rollout to beta customers.”
- d77 [off_facet] hustronix_feature_quality_regression_d77_scope_changed__slack_message: No keyword hit, no pattern facet, no shared primary entity. Likely off-facet / ambient relative to the situation.
  “[Message] channel=product user=samira Samira in #product: Product accepts limited rollout to beta customers. (cc Elena, Skye)”
