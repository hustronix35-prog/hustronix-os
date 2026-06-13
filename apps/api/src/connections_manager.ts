import { broadcast } from "./server.js";
import { db } from "./database.js";

export type CapabilityStatus = "HEALTHY" | "DEGRADED" | "IDLE" | "ERROR" | "PAUSED";

export interface BusinessCapability {
  id: string;
  name: string;
  status: CapabilityStatus;
  description: string;
  lastPulse: string;
  resolutionPath?: string;
  metrics: {
    label: string;
    value: string;
    trend: "up" | "down" | "neutral";
  }[];
}

class ConnectionsManager {
  private capabilities: Map<string, BusinessCapability> = new Map();

  constructor() {
    this.initCapabilities();
  }

  private initCapabilities() {
    this.capabilities.set("conversion-optimizer", {
      id: "conversion-optimizer",
      name: "Landing Page & Checkout Velocity System",
      status: "HEALTHY",
      description: "Monitoring real-time conversion rates and friction points.",
      lastPulse: new Date().toISOString(),
      metrics: [
        { label: "Cvr Delta", value: "+4.2%", trend: "up" },
        { label: "Friction", value: "Low", trend: "down" }
      ]
    });
  }

  getCapability(id: string): BusinessCapability | undefined {
    return this.capabilities.get(id);
  }

  getAllCapabilities(): BusinessCapability[] {
    return Array.from(this.capabilities.values());
  }

  updateStatus(id: string, status: CapabilityStatus, resolution?: string) {
    const cap = this.capabilities.get(id);
    if (cap) {
      cap.status = status;
      cap.lastPulse = new Date().toISOString();
      if (resolution) cap.resolutionPath = resolution;
      
      broadcast("CAPABILITY_UPDATE", { capability: cap });
      
      if (status === "DEGRADED" || status === "ERROR") {
        broadcast("SIGNAL_ALERT", {
          urgency: 0.9,
          type: "SYSTEM_DEGRADATION",
          message: `${cap.name} is now ${status}.`
        });
      }
    }
  }

  async syncProtocols() {
    // Mock sync logic
    console.log("🔄 [Connections] Syncing all business protocols...");
    for (const [id, cap] of this.capabilities) {
      broadcast("CAPABILITY_UPDATE", { capability: { ...cap, status: "HEALTHY" } });
    }
    return { success: true };
  }
}

export const connectionsManager = new ConnectionsManager();
