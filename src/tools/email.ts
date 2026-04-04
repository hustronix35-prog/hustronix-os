import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { config } from "../config.js";

// ── IMAP helper ──────────────────────────────────────────
function createImapClient() {
  return new ImapFlow({
    host: config.email.imapHost,
    port: config.email.imapPort,
    secure: true,
    auth: {
      user: config.email.address,
      pass: config.email.password,
    },
    logger: false,
  });
}

// ── SMTP helper ──────────────────────────────────────────
const smtpTransport = config.email.enabled
  ? nodemailer.createTransport({
      host: config.email.smtpHost,
      port: config.email.smtpPort,
      secure: true,
      auth: {
        user: config.email.address,
        pass: config.email.password,
      },
    })
  : null;

// ════════════════════════════════════════════════════════════
// Tool 1: email_read_inbox
// ════════════════════════════════════════════════════════════
export const readInboxDef = {
  name: "email_read_inbox",
  description:
    "Fetch the latest emails from the user's inbox. Returns sender, subject, date, a short snippet, and a uid for each message.",
  parameters: {
    type: "object" as const,
    properties: {
      count: {
        type: "number",
        description: "Number of recent emails to fetch (default 5, max 20)",
      },
    },
    required: [],
  },
};

export async function readInboxHandler(args: {
  count?: number;
}): Promise<string> {
  const count = Math.min(args.count || 5, 20);
  const client = createImapClient();

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const totalMessages = (client.mailbox as any)?.exists || 0;
      if (totalMessages === 0) return "📭 Your inbox is empty.";

      const startSeq = Math.max(1, totalMessages - count + 1);
      const results: any[] = [];

      for await (const msg of client.fetch(`${startSeq}:*`, {
        uid: true,
        envelope: true,
        bodyStructure: true,
      })) {
        const envelope = msg.envelope!;
        const from = envelope.from?.[0];
        results.push({
          uid: msg.uid,
          from: from ? `${from.name || ""} <${from.address}>` : "Unknown",
          subject: envelope.subject || "(no subject)",
          date: envelope.date?.toISOString() || "Unknown",
        });
      }

      // Reverse so newest first
      results.reverse();
      return JSON.stringify(results, null, 2);
    } finally {
      lock.release();
    }
  } catch (err: any) {
    console.error("❌ IMAP read error:", err.message);
    return `Error reading inbox: ${err.message}`;
  } finally {
    await client.logout().catch(() => {});
  }
}

// ════════════════════════════════════════════════════════════
// Tool 2: email_read_message
// ════════════════════════════════════════════════════════════
export const readMessageDef = {
  name: "email_read_message",
  description:
    "Read the full body of a specific email by its UID. Returns the plain-text content.",
  parameters: {
    type: "object" as const,
    properties: {
      uid: {
        type: "number",
        description: "The UID of the email to read (from email_read_inbox)",
      },
    },
    required: ["uid"],
  },
};

export async function readMessageHandler(args: {
  uid: number;
}): Promise<string> {
  const client = createImapClient();

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const rawSource = await client.download(String(args.uid), undefined, {
        uid: true,
      });
      const parsed = await simpleParser(rawSource.content);

      const from =
        parsed.from?.text || "Unknown";
      const subject = parsed.subject || "(no subject)";
      const date = parsed.date?.toISOString() || "Unknown";
      const body = parsed.text || "(no text body — may be HTML-only)";

      // Truncate very long emails
      const truncBody =
        body.length > 3000 ? body.slice(0, 3000) + "\n...[truncated]" : body;

      return `From: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${truncBody}`;
    } finally {
      lock.release();
    }
  } catch (err: any) {
    console.error("❌ IMAP read message error:", err.message);
    return `Error reading message: ${err.message}`;
  } finally {
    await client.logout().catch(() => {});
  }
}

// ════════════════════════════════════════════════════════════
// Tool 3: email_send
// ════════════════════════════════════════════════════════════
export const sendEmailDef = {
  name: "email_send",
  description:
    "Compose and send a new email. Provide the recipient, subject line, and body text.",
  parameters: {
    type: "object" as const,
    properties: {
      to: { type: "string", description: "Recipient email address" },
      subject: { type: "string", description: "Email subject line" },
      body: { type: "string", description: "Email body content (plain text)" },
    },
    required: ["to", "subject", "body"],
  },
};

export async function sendEmailHandler(args: {
  to: string;
  subject: string;
  body: string;
}): Promise<string> {
  if (!smtpTransport) return "Email is not configured.";

  try {
    const info = await smtpTransport.sendMail({
      from: `"Gravity Claw" <${config.email.address}>`,
      to: args.to,
      subject: args.subject,
      text: args.body,
    });

    console.log(`📧 Email sent: ${info.messageId}`);
    return `✅ Email sent successfully to ${args.to} (ID: ${info.messageId})`;
  } catch (err: any) {
    console.error("❌ SMTP send error:", err.message);
    return `Error sending email: ${err.message}`;
  }
}

// ════════════════════════════════════════════════════════════
// Tool 4: email_reply
// ════════════════════════════════════════════════════════════
export const replyEmailDef = {
  name: "email_reply",
  description:
    "Reply to an existing email by its UID. Maintains proper email threading.",
  parameters: {
    type: "object" as const,
    properties: {
      uid: {
        type: "number",
        description: "The UID of the email to reply to",
      },
      body: {
        type: "string",
        description: "The reply body (plain text)",
      },
    },
    required: ["uid", "body"],
  },
};

export async function replyEmailHandler(args: {
  uid: number;
  body: string;
}): Promise<string> {
  if (!smtpTransport) return "Email is not configured.";
  const client = createImapClient();

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    let originalFrom: string;
    let originalSubject: string;
    let messageId: string | undefined;
    let references: string | undefined;

    try {
      const rawSource = await client.download(String(args.uid), undefined, {
        uid: true,
      });
      const parsed = await simpleParser(rawSource.content);

      originalFrom = parsed.from?.value?.[0]?.address || "";
      originalSubject = parsed.subject || "";
      messageId = parsed.messageId;
      references = parsed.references
        ? (Array.isArray(parsed.references)
            ? parsed.references.join(" ")
            : parsed.references)
        : undefined;
    } finally {
      lock.release();
    }

    // Build threading headers
    const replySubject = originalSubject.startsWith("Re:")
      ? originalSubject
      : `Re: ${originalSubject}`;

    const headers: Record<string, string> = {};
    if (messageId) {
      headers["In-Reply-To"] = messageId;
      headers["References"] = references
        ? `${references} ${messageId}`
        : messageId;
    }

    const info = await smtpTransport.sendMail({
      from: `"Gravity Claw" <${config.email.address}>`,
      to: originalFrom,
      subject: replySubject,
      text: args.body,
      headers,
    });

    console.log(`📧 Reply sent to ${originalFrom}: ${info.messageId}`);
    return `✅ Reply sent to ${originalFrom} (${replySubject})`;
  } catch (err: any) {
    console.error("❌ Reply error:", err.message);
    return `Error replying: ${err.message}`;
  } finally {
    await client.logout().catch(() => {});
  }
}
