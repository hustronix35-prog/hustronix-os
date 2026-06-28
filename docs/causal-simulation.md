# Causal Simulation

Graph-based **deterministic** consequence modeling — not LLM simulation.

## Flow

1. Identify affected entities from decision + evidence graph
2. Propagate along `CAUSED_BY`, `SUPPORTS`, `CONTRADICTS` edges
3. Apply capacity, revenue, and churn templates
4. Emit scenario cards with probabilities

## Storage

`simulation_runs` — `input_graph_hash`, `input_json`, `output_projection_json`, `risk_score`

## API

`POST /api/decisions/simulate`

```json
{
  "decisionId": "optional-uuid",
  "vow": "Increase enterprise pricing 15%",
  "capacityDelta": { "engineering": 0.1 },
  "revenueDeltaPct": 0.15,
  "churnRiskDelta": 0.05
}
```

Response includes `scenarios[]`, `twin_snapshot`, and `max_risk`.

## LLM narrative

Optional prose layer only when `risk > threshold` **and** reasoning router selects L3+.

## Module

`apps/api/src/simulation/causal-simulator.ts`
