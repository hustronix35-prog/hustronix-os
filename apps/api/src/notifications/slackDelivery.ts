export type SlackInstallForDm = {
  access_token: string;
  bot_user_id: string | null;
  raw_install_payload: string | null;
};

function extractAuthedUserId(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { authed_user?: { id?: string } };
    const id = j?.authed_user?.id;
    if (id && String(id).startsWith("U")) return String(id);
  } catch {
    /* ignore */
  }
  return null;
}

async function slackApi(token: string, method: string, body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string; channel?: { id?: string } }> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { ok?: boolean; error?: string; channel?: { id?: string } };
}

/**
 * Opens a DM with the installing user (when `authed_user.id` is present in the OAuth payload) and posts text.
 * Logs and returns false when token/user/channel is missing or Slack returns an error.
 */
export async function postSlackDirectMessage(install: SlackInstallForDm, text: string): Promise<boolean> {
  const token = String(install.access_token || "").trim();
  if (!token) {
    console.warn("[notifications][slack] missing bot access_token on install row");
    return false;
  }
  const slackUser = extractAuthedUserId(install.raw_install_payload);
  if (!slackUser) {
    console.warn(
      "[notifications][slack] cannot open DM: authed_user.id missing from install payload (re-connect Slack to refresh)",
    );
    return false;
  }
  try {
    const open = await slackApi(token, "conversations.open", { users: slackUser });
    if (!open.ok || !open.channel?.id) {
      console.warn("[notifications][slack] conversations.open failed:", open.error || open);
      return false;
    }
    const channelId = open.channel.id;
    const post = await slackApi(token, "chat.postMessage", {
      channel: channelId,
      text: text.slice(0, 4000),
    });
    if (!post.ok) {
      console.warn("[notifications][slack] chat.postMessage failed:", post.error || post);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[notifications][slack] postSlackDirectMessage error:", e);
    return false;
  }
}
