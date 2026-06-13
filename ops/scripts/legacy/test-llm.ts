import { chat } from "../../../apps/api/src/llm.ts";
chat("411d412c-b8ab-40c9-a96b-0434e827c5dc", [{role: "user", content: "test"}])
  .then(console.log)
  .catch(console.error);
