// POST /discord/interactions (TD-27, D-32): Discord's HTTP interactions
// endpoint. Outside /api: no session cookie or CSRF check; every request must
// carry a valid Ed25519 signature instead.
//
// "정글5에 올리기" (message command): checks run synchronously (3 s budget),
// then a deferred ephemeral response; the download, post creation and the
// messages happen in waitUntil.
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { LIMITS } from "../../shared/constants";
import { nameKey, uuidv7 } from "../../shared/ids";
import { hasHtmlExtension, htmlFilenameSchema } from "../../shared/schemas";
import { categories, members, postHtml, posts } from "../db/schema";
import { decodeHtmlBytes, htmlTitle, writePostHtml } from "../lib/postHtml";
import { discordUploadDenial, type Actor } from "../policies";
import { isUniqueViolation } from "../routes/views";
import type { AppEnv, Db } from "../types";
import { UPLOAD_COMMAND_NAME, type DiscordAppClient } from "./appClient";
import { verifyDiscordSignature } from "./verify";

// Discord interaction / response types (subset).
const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMMAND = 3;
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const DEFERRED_CHANNEL_MESSAGE = 5;
const EPHEMERAL = 64;

interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
}

interface DiscordMessage {
  id: string;
  channel_id?: string;
  author: { id: string };
  attachments?: DiscordAttachment[];
}

interface Interaction {
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id: string } };
  user?: { id: string };
  data?: {
    name?: string;
    type?: number;
    target_id?: string;
    resolved?: { messages?: Record<string, DiscordMessage> };
  };
}

export const MESSAGES = {
  notAuthor: "본인이 올린 메시지만 올릴 수 있어요",
  notMember: "먼저 https://jungle5.xyz 에 로그인해 주세요",
  noHtml: "HTML 파일(.html, .htm)이 첨부된 메시지에서만 쓸 수 있어요",
  multipleHtml: "HTML 파일이 여러 개예요. 파일 하나만 첨부된 메시지에서 써 주세요",
  // Discord files are stored uncompressed (no server-side gzip: 10 ms CPU), so
  // the bigger site limit (D-30) is only reachable from the editor.
  tooLarge: `${LIMITS.htmlDiscordMaxBytes / 1_000_000}MB가 넘는 파일은 사이트 글쓰기에서 올려 주세요 (최대 ${LIMITS.htmlMaxOriginalBytes / 1_000_000}MB): https://jungle5.xyz/posts/new`,
  notUtf8: "UTF-8 텍스트로 된 HTML 파일만 올릴 수 있어요",
  wrongGuild: "정글5 Discord 서버에서만 쓸 수 있어요",
  unknown: "지원하지 않는 명령이에요",
  failed: "올리지 못했어요. 잠시 후 다시 시도해 주세요",
} as const;

const postUrl = (env: Env, postId: string) => `${env.APP_ORIGIN}/posts/${postId}`;

const ephemeral = (content: string) => ({
  type: CHANNEL_MESSAGE,
  data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
});

/** Discord Markdown would otherwise render a user-chosen title (links, formatting). */
const escapeMarkdown = (s: string) => s.replace(/[\\*_~`|[\]()<>#-]/g, (m) => `\\${m}`);

class Refusal extends Error {
  override name = "Refusal";
}

export const interactionRoutes = new Hono<AppEnv>().post("/interactions", async (c) => {
  const raw = await c.req.text();
  const ok = await verifyDiscordSignature(
    c.env.DISCORD_PUBLIC_KEY,
    c.req.header("X-Signature-Ed25519"),
    c.req.header("X-Signature-Timestamp"),
    raw,
  );
  if (!ok) return c.json({ error: { code: "UNAUTHENTICATED", message: "invalid request signature" } }, 401);

  let interaction: Interaction;
  try {
    interaction = JSON.parse(raw) as Interaction;
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "invalid JSON" } }, 400);
  }
  if (interaction.type === PING) return c.json({ type: PONG });

  const data = interaction.data;
  if (interaction.type !== APPLICATION_COMMAND || data?.type !== MESSAGE_COMMAND || data.name !== UPLOAD_COMMAND_NAME) {
    return c.json(ephemeral(MESSAGES.unknown));
  }
  if (interaction.guild_id !== c.env.DISCORD_GUILD_ID) return c.json(ephemeral(MESSAGES.wrongGuild));

  const invokerId = interaction.member?.user?.id ?? interaction.user?.id ?? "";
  const message = data.target_id ? data.resolved?.messages?.[data.target_id] : undefined;
  if (!message) return c.json(ephemeral(MESSAGES.failed));

  const db = c.get("db");
  // 2 queries, concurrently: the invoker's site membership and an earlier upload of this message.
  const [memberRow, existing] = await Promise.all([
    invokerId
      ? db
          .select({
            id: members.id,
            isAdmin: members.isAdmin,
            isGuildMember: members.isGuildMember,
            withdrawnAt: members.withdrawnAt,
          })
          .from(members)
          .where(eq(members.discordUserId, invokerId))
          .get()
      : Promise.resolve(undefined),
    db.select({ postId: postHtml.postId }).from(postHtml).where(eq(postHtml.discordMessageId, message.id)).get(),
  ]);
  const actor: Actor | null = memberRow
    ? {
        id: memberRow.id,
        isAdmin: memberRow.isAdmin,
        isGuildMember: memberRow.isGuildMember,
        withdrawn: memberRow.withdrawnAt !== null,
      }
    : null;

  const denial = discordUploadDenial(actor, invokerId, message.author.id);
  if (denial === "not_author") return c.json(ephemeral(MESSAGES.notAuthor));

  const htmlFiles = (message.attachments ?? []).filter((a) => hasHtmlExtension(a.filename));
  if (htmlFiles.length === 0) return c.json(ephemeral(MESSAGES.noHtml));
  if (htmlFiles.length > 1) return c.json(ephemeral(MESSAGES.multipleHtml));
  const attachment = htmlFiles[0]!;
  if (attachment.size > LIMITS.htmlDiscordMaxBytes) return c.json(ephemeral(MESSAGES.tooLarge));

  if (denial === "not_member" || !actor) return c.json(ephemeral(MESSAGES.notMember));
  if (existing) return c.json(ephemeral(`이미 올린 메시지예요: ${postUrl(c.env, existing.postId)}`));

  const deps = c.get("deps");
  const client = deps.discordApp(c.env, deps.fetch);
  c.executionCtx.waitUntil(
    uploadInBackground(db, c.env, client, {
      actor,
      attachment,
      messageId: message.id,
      channelId: message.channel_id ?? interaction.channel_id ?? null,
      token: interaction.token,
      now: deps.now(),
    }),
  );
  return c.json({ type: DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } });
});

interface UploadJob {
  actor: Actor;
  attachment: DiscordAttachment;
  messageId: string;
  channelId: string | null;
  token: string;
  now: number;
}

/**
 * Download → validate → create the post (category 기타) + its HTML in one
 * batch → edit the ephemeral original, then a public follow-up with the link.
 * The original is edited first: a follow-up sent while the deferred response
 * is still "thinking" would replace it (and inherit its ephemeral flag).
 * Queries: category (1) + batch (1), plus 1 on a duplicate race.
 */
async function uploadInBackground(db: Db, env: Env, client: DiscordAppClient, job: UploadJob): Promise<void> {
  try {
    let bytes: Uint8Array;
    try {
      bytes = await client.downloadAttachment(job.attachment.url, LIMITS.htmlDiscordMaxBytes);
    } catch (err) {
      if (err instanceof Error && "status" in err && err.status === 413) throw new Refusal(MESSAGES.tooLarge);
      throw err;
    }
    // Same checks and pieces as a site upload (TD-25).
    const decoded = decodeHtmlBytes(bytes, LIMITS.htmlDiscordMaxBytes);
    if (!decoded.ok) throw new Refusal(decoded.problem === "too_large" ? MESSAGES.tooLarge : MESSAGES.notUtf8);
    const name = htmlFilenameSchema.safeParse(job.attachment.filename);
    const filename = name.success ? name.data : "discord.html";
    // The <title> is searched only near the start, always inside the first piece.
    const title = htmlTitle(decoded.pieces[0] ?? "", filename);

    const category = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.nameKey, nameKey("기타")))
      .get();
    if (!category) throw new Error("seed category 기타 is missing");

    const postId = uuidv7(job.now);
    const source = job.channelId
      ? ` [원래 메시지](https://discord.com/channels/${env.DISCORD_GUILD_ID}/${job.channelId}/${job.messageId})`
      : "";
    try {
      await db.batch([
        db.insert(posts).values({
          id: postId,
          title,
          body: `Discord에서 올린 HTML입니다.${source}`,
          categoryId: category.id,
          authorId: job.actor.id,
          roundId: null,
          links: "[]",
          createdAt: job.now,
          updatedAt: job.now,
        }),
        ...writePostHtml(db, postId, { filename, encoding: "identity", pieces: decoded.pieces, size: decoded.size }, job.now, "discord", job.messageId),
      ]);
    } catch (err) {
      // Same message uploaded concurrently: the batch rolled back; point at the winner.
      if (!isUniqueViolation(err)) throw err;
      const winner = await db
        .select({ postId: postHtml.postId })
        .from(postHtml)
        .where(eq(postHtml.discordMessageId, job.messageId))
        .get();
      if (!winner) throw err;
      await client.editOriginal(job.token, `이미 올린 메시지예요: ${postUrl(env, winner.postId)}`);
      return;
    }

    const link = postUrl(env, postId);
    await client.editOriginal(job.token, `등록했습니다. 카테고리·태그는 사이트에서 바꿀 수 있어요: ${link}`);
    try {
      await client.followUp(job.token, `📄 ${escapeMarkdown(title)} — 정글5에서 보기: ${link}`);
    } catch (err) {
      // The post exists and the author was told; only the channel notice is missing.
      console.error(JSON.stringify({ level: "warn", where: "discord follow-up", error: String(err) }));
    }
  } catch (err) {
    const content = err instanceof Refusal ? err.message : MESSAGES.failed;
    if (!(err instanceof Refusal)) {
      console.error(JSON.stringify({ level: "error", where: "discord upload", error: String(err) }));
    }
    try {
      await client.editOriginal(job.token, content);
    } catch (e) {
      console.error(JSON.stringify({ level: "error", where: "discord edit original", error: String(e) }));
    }
  }
}
