"use client";

import { useEffect, useState } from "react";
import { KnowledgeGraph } from "@/components/viz/Visualizations";
import { fetchBrainSummary } from "@/lib/api";
import type { KGEdge, KGNode } from "@/lib/types";
import { BrainEntityShell } from "../_shared";

export default function BrainGraphPage() {
  const [loaded, setLoaded] = useState(false);
  const [nodes, setNodes] = useState<KGNode[]>([]);
  const [edges, setEdges] = useState<KGEdge[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchBrainSummary()
      .then((summary) => {
        if (cancelled) return;
        setNodes((summary?.graph.nodes ?? []) as KGNode[]);
        setEdges((summary?.graph.edges ?? []) as KGEdge[]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <BrainEntityShell active="Graph" newLabel="Graph">
      <KnowledgeGraph
        nodes={loaded ? nodes : undefined}
        edges={loaded ? edges : undefined}
      />
    </BrainEntityShell>
  );
}
