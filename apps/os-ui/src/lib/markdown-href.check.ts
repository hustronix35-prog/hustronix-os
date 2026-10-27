import { safeMarkdownHref } from "./markdown-href.js";

if (safeMarkdownHref("javascript:alert(1)") !== undefined) throw new Error("js scheme");
if (safeMarkdownHref("https://hustronix.app/x") !== "https://hustronix.app/x") throw new Error("https");
if (safeMarkdownHref("/decide") !== "/decide") throw new Error("relative");
if (safeMarkdownHref("#risks") !== "#risks") throw new Error("hash");
console.log("markdown-href.check ok");
