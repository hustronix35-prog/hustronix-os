HUSTRONIX UNSEEN / GENERALIZATION TEST
────────────────────────────────────
No HSOG scenario IDs, playbooks, or taught pattern keys in ingest.

| Scenario | Discovered | Theme | Entity | Aware | Ready | Decl | Lead | Stage | Resolved |
|---|:---:|:---:|:---:|---:|---:|---:|---:|---|:---:|
| HelixBio privacy / DSAR | ✓ | ✓ | ✓ | 12 | 14 | 16 | +2d | DECISION_READY | — |
| PayOrbit vendor payment risk | ✓ | ✓ | ✓ | 22 | 24 | 24 | 0d | RESOLVED | ✓ |
| Northwind campaign budget pressure | ✓ | ✓ | ✓ | 32 | 34 | 34 | 0d | DECISION_READY | — |
| LatticeOps delivery risk | ✓ | ✓ | ✓ | 42 | — | 44 | — | RESOLVED | ✓ |

Discovery rate: 4/4 (100%)
Average lead (ready vs declaration): +0.7 days
De-escalation: 2/2 resolve stories improved/resolved

HUSTRONIX CHAT E2E (Situation-grounded)
────────────────────────────────────
✓ Q: What is happening with HelixBio?
   grounded=true missing=[]
   → HelixBio: privacy request is worsening (stage: DECISION_READY).  First observed on day 12.  DECISION_READY: HelixBio: privacy request. Facets=request,residency,legal. Evidence=4. Trajectory=WORSENING.  Confidence: 92%.  
✓ Q: Why is PayOrbit a risk?
   grounded=true missing=[]
   → PayOrbit: vendor risk is improving (stage: RESOLVED).  First observed on day 22.  RESOLVED: PayOrbit: vendor risk. Facets=vendor,payment,service. Evidence=4. Trajectory=IMPROVING.  Confidence: 67%.  Evidence dimensions: 
✓ Q: What evidence do we have on Northwind?
   grounded=true missing=[]
   → Northwind: budget pressure is stable (stage: DECISION_READY).  First observed on day 32.  DECISION_READY: Northwind: budget pressure. Facets=spend,forecast,approval. Evidence=3. Trajectory=STABLE.  Confidence: 92%.  Evid
✓ Q: Who is affected by LatticeOps?
   grounded=true missing=[]
   → LatticeOps: delivery risk is improving (stage: RESOLVED).  First observed on day 42.  RESOLVED: LatticeOps: delivery risk. Facets=blocker,quality,schedule. Evidence=4. Trajectory=IMPROVING.  Confidence: 67%.  Evidence di
✓ Q: What should we do about HelixBio privacy?
   grounded=true missing=[]
   → HelixBio: privacy request is worsening (stage: DECISION_READY).  First observed on day 12.  DECISION_READY: HelixBio: privacy request. Facets=request,residency,legal. Evidence=4. Trajectory=WORSENING.  Confidence: 92%.  

Passed 5/5
