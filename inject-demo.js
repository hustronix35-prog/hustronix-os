
import { db } from "./src/database.js";
import { v4 as uuidv4 } from "uuid";

async function injectDeterministicLoopDemo() {
  console.log("Upgrading Demo to 'Deterministic Growth OS' (Execution Guarantee)...");

  const targetUserIds = ["411d412c-b8ab-40c9-a96b-0434e827c5dc", "system"];

  // Clear existing to ensure fresh demo
  db.raw.prepare("DELETE FROM messages").run();
  db.raw.prepare("DELETE FROM chat_sessions").run();

  const assistantResponse1 = `
**If you do only one thing today: remove the signup wall and show products first.**

### **What matters most right now**
Fix onboarding trust to multiply later conversion wins. Improving retention is a force-multiplier for all future traffic.

---

### **The Decision**
- **Confidence Score**: **9.2/10**
- **Owner**: Founder / Growth Lead
- **Core Problem**: High signup volume but critical "Activation Gap."
- **Root Cause**: Asking for identity before revealing value.
- **🔥 Priority #1 Action**: **Visual-First Onboarding**
- **If Ignored**: You’ll continue burning CAC on users who churn within 24h.

---

### **Next 72 Hours**
- **Day 1-2**: Deploy "Visual Grid" Onboarding; remove signup wall.
- **Day 3**: Measure retention + survey completion.
- **Failure Branch**: If uplift <10% after 48h, shift to "Instant Preview" mode.

---

### **The Outcome Goal (Execution Guarantee)**
- **Expected Change**: Day-1 Retention 15% → 35% within 72 hours.
- **The Next Trigger**: Once Account Creation % crosses 25%, the system will auto-activate Phase 2.
- **Follow-up Decision**: We will then pivot focus to **AOV Protection** (Bundling artisanal products).

**Question: Are you focused on mobile or desktop conversion first?**
  `.trim();

  const assistantResponse2 = `
**If you do only one thing today: Audit your product photos to ensure the "Hand-Lasted" detail is visible in the first hover.**

### **Phase 2: Protect your premium positioning**
Premium UVP is lost in a standard commodity grid; we must anchor price to process.

---

### **The Decision**
- **Confidence Score**: **8.8/10**
- **Owner**: Creative / Marketing Lead
- **🔥 Priority #1 Action**: **Process-Anchored Product Details**
- **What NOT to do**: Do not add a Chatbot. It adds text friction to a visual brand.

---

### **The Roadmap**
- **Next 72 Hours**: Create and deploy 3 artisan micro-clips for top SKUs.
- **Failure Branch**: If ATC doesn't move >5%, simplify to static "Artisan Signature" annotations.

---

### **The Outcome Goal (Execution Guarantee)**
- **Expected Change**: Hover-to-Cart Conversion 4% → 8%.
- **The Next Trigger**: Once Cart-Adds stabilize >7%, we trigger the "Price-Defense" module.
- **Follow-up Decision**: We will then activate **Loyalty Mechanics** to protect repeat purchase margins.

**The Loop**: We adapt based on what happens next. Feed results back to refine the next decision layer.
  `.trim();

  for (const userId of targetUserIds) {
    const sessionId = uuidv4();
    db.raw.prepare("INSERT INTO chat_sessions (id, title, user_id, updated_at) VALUES (?, ?, ?, ?)")
      .run(sessionId, "Hustronix: Deterministic Growth", userId, "2026-04-16 01:50:00");

    db.raw.prepare("INSERT INTO messages (id, session_id, user_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)")
      .run(uuidv4(), sessionId, userId, "user", "i have a shoe business on my website Users are likely not seeing value quickly after signup, causing drop-off during onboarding", "2026-04-16 01:50:01");

    db.raw.prepare("INSERT INTO messages (id, session_id, user_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)")
      .run(uuidv4(), sessionId, userId, "assistant", assistantResponse1, "2026-04-16 01:50:05");

    db.raw.prepare("INSERT INTO messages (id, session_id, user_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)")
      .run(uuidv4(), sessionId, userId, "user", "https://gullylabs.com/ is my website", "2026-04-16 01:50:10");

    db.raw.prepare("INSERT INTO messages (id, session_id, user_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)")
      .run(uuidv4(), sessionId, userId, "assistant", assistantResponse2, "2026-04-16 01:50:15");
  }

  console.log("✅ 'Deterministic Growth OS' is now live with Outcome Guarantees.");
}

injectDeterministicLoopDemo().catch(console.error);
