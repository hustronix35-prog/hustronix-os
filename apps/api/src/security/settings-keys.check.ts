import { assertWritableSettingKey, InvalidSettingKeyError } from "./settings-keys.js";

let threw = false;
try {
  assertWritableSettingKey("core_memory.organization");
} catch (e) {
  threw = e instanceof InvalidSettingKeyError;
}
assertWritableSettingKey("org.agent_context_digest");
if (!threw) throw new Error("expected core_memory.organization to be rejected");
console.log("settings-keys.check ok");
