import { upsertNode, createEdge, searchNode } from "../graph.js";

// ====== Tool 1: kg_add_node ======
export const addNodeDef = {
  name: "kg_add_node",
  description: "Add a new Entity Node to the Knowledge Graph, or update an existing one. Use this to remember people, places, projects, or core concepts.",
  parameters: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "Exact, unique name of the entity (e.g. 'john_doe', 'gravity_claw')"
      },
      label: {
        type: "string",
        description: "Category label for the entity (e.g. 'PERSON', 'PROJECT', 'CONCEPT')"
      },
      attributes: {
        type: "object" as const,
        description: "JSON key-value pairs of known facts about the entity"
      }
    },
    required: ["name", "label", "attributes"]
  }
};

export async function addNodeHandler(args: { name: string, label: string, attributes: Record<string, any> }): Promise<string> {
  return upsertNode(args.name, args.label, args.attributes);
}

// ====== Tool 2: kg_add_edge ======
export const addEdgeDef = {
  name: "kg_add_edge",
  description: "Connect two existing Knowledge Graph Entities together with a directed relationship edge. Both nodes MUST already exist via kg_add_node.",
  parameters: {
    type: "object" as const,
    properties: {
      source: { type: "string", description: "Name of the source node" },
      target: { type: "string", description: "Name of the target node" },
      relation: { type: "string", description: "Verb phrase describing the relationship (e.g. 'WORKS_ON', 'CREATED_BY', 'LIKES')" },
      metadata: { type: "object" as const, description: "Optional extra contextual JSON attributes about this specific relationship" }
    },
    required: ["source", "target", "relation"]
  }
};

export async function addEdgeHandler(args: { source: string, target: string, relation: string, metadata?: Record<string, any> }): Promise<string> {
  return createEdge(args.source, args.target, args.relation, args.metadata || {});
}

// ====== Tool 3: kg_search ======
export const searchGraphDef = {
  name: "kg_search",
  description: "Search the Knowledge Graph for an exact entity name. Returns the entity's attributes and an immediate 1-degree mapping of all outbound and inbound relationships.",
  parameters: {
    type: "object" as const,
    properties: {
      name: { type: "string", description: "Name of the entity to query" }
    },
    required: ["name"]
  }
};

export async function searchGraphHandler(args: { name: string }): Promise<string> {
  return searchNode(args.name);
}
