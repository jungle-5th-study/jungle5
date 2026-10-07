// POST /discord/interactions (TD-27, D-32) and the admin command registration.
// Requests are signed with a real Ed25519 key pair generated here; Discord's
// HTTP API and CDN are a mocked fetch.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { LIMITS } from "../../src/shared/constants";
import { MESSAGES } from "../../src/worker/discord/interactions";
import { call, GUILD_ID, login, makeApp, ORIGIN, SEED_CATEGORY_ID, type TestUser } from "../helpers";

const COMMAND = "정글5에 올리기";
const APP_ID = env.DISCORD_CLIENT_ID;
const CDN = "https://cdn.discordapp.com/attachments/1/2/page.html?ex=1&is=2&hm=3";

let keys: CryptoKeyPair;
let publicKeyHex: string;
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKeyHex = hex((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer);
});

interface FetchCall {
  url: string;
  method: string;
  body: string;
  headers: Headers;
}

/** fetch stub: CDN serves `files[url]`; Discord API answers 200 (or `fail` statuses). */
function mockFetch(files: Record<string, string | Uint8Array> = {}, fail: Record<string, number> = {}) {
  const calls: FetchCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const body = req.method === "GET" ? "" : new TextDecoder().decode(await req.arrayBuffer());
    calls.push({ url: req.url, method: req.method, body, headers: req.headers });
    for (const [prefix, status] of Object.entries(fail)) {
      if (req.url.startsWith(prefix)) return new Response("{}", { status });
    }
    if (req.url in files) return new Response(files[req.url]);
    if (req.url.startsWith("https://discord.com/api/v10/oauth2/token")) {
      return Response.json({ access_token: "cc-token", token_type: "Bearer", expires_in: 604800 });
    }
    if (req.url.includes("/commands")) {
      return Response.json({ id: "999", name: COMMAND, type: 3, guild_id: GUILD_ID, application_id: APP_ID });
    }
    if (req.url.startsWith("https://discord.com/api/v10/webhooks/")) return Response.json({ id: "m1" });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fn, calls };
}

async function signedCall(
  app: ReturnType<typeof makeApp>,
  payload: unknown,
  opts: { tamper?: boolean; noSig?: boolean; publicKey?: string } = {},
) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = hex(await crypto.subtle.sign({ name: "Ed25519" }, keys.privateKey, new TextEncoder().encode(timestamp + body)));
  const headers = new Headers({ "Content-Type": "application/json", "X-Signature-Timestamp": timestamp });
  if (!opts.noSig) headers.set("X-Signature-Ed25519", sig);
  const ctx = createExecutionContext();
  const res = await app.request(
    `${ORIGIN}/discord/interactions`,
    { method: "POST", headers, body: opts.tamper ? body.replace("}", ',"x":1}') : body },
    { ...env, DISCORD_PUBLIC_KEY: opts.publicKey ?? publicKeyHex },
    ctx,
  );
  // The deferred work (download, post, messages) runs in waitUntil.
  await waitOnExecutionContext(ctx);
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: json as any, headers: res.headers };
}

let msgSeq = 0;
function messageCommand(opts: {
  invoker: string;
  author?: string;
  attachments?: { filename: string; size: number; url?: string }[];
  messageId?: string;
  guildId?: string;
  name?: string;
}) {
  const messageId = opts.messageId ?? `7${Date.now()}${++msgSeq}`.slice(0, 19);
  return {
    type: 2,
    id: "1",
    application_id: APP_ID,
    token: "interaction-token-abc",
    guild_id: opts.guildId ?? GUILD_ID,
    channel_id: "555",
    member: { user: { id: opts.invoker } },
    data: {
      type: 3,
      name: opts.name ?? COMMAND,
      target_id: messageId,
      resolved: {
        messages: {
          [messageId]: {
            id: messageId,
            channel_id: "555",
            author: { id: opts.author ?? opts.invoker },
            attachments: (opts.attachments ?? [{ filename: "page.html", size: 100 }]).map((a, i) => ({
              id: `a${i}`,
              filename: a.filename,
              size: a.size,
              url: a.url ?? CDN,
              proxy_url: a.url ?? CDN,
            })),
          },
        },
      },
    },
  };
}

const ephemeralText = (json: { type: number; data: { flags: number; content: string } }) => {
  expect(json.type).toBe(4);
  expect(json.data.flags).toBe(64);
  return json.data.content;
};

async function postsBy(memberId: string) {
  return (
    await env.DB.prepare(
      "SELECT p.id, p.title, p.body, p.category_id, h.filename, h.html, h.size, h.uploaded_via, h.discord_message_id FROM posts p LEFT JOIN post_html h ON h.post_id = p.id WHERE p.author_id = ? ORDER BY p.created_at",
    )
      .bind(memberId)
      .all<Record<string, unknown>>()
  ).results;
}

describe("signature and PING", () => {
  const app = makeApp();

  it("missing, invalid or tampered signature → 401; unset public key → 401", async () => {
    expect((await signedCall(app, { type: 1 }, { noSig: true })).status).toBe(401);
    expect((await signedCall(app, { type: 1 }, { tamper: true })).status).toBe(401);
    const other = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const otherHex = hex((await crypto.subtle.exportKey("raw", other.publicKey)) as ArrayBuffer);
    expect((await signedCall(app, { type: 1 }, { publicKey: otherHex })).status).toBe(401);
    expect((await signedCall(app, { type: 1 }, { publicKey: "" })).status).toBe(401);
    expect((await signedCall(app, { type: 1 }, { publicKey: "zz" })).status).toBe(401);
  });

  it("PING → PONG", async () => {
    const res = await signedCall(app, { type: 1 });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ type: 1 });
  });

  it("is outside /api: no session or CSRF needed, and GET is 404", async () => {
    const res = await call(app, "GET", "/discord/interactions");
    expect(res.status).toBe(404);
  });

  it("unknown commands get an ephemeral notice", async () => {
    const res = await signedCall(app, messageCommand({ invoker: "1", name: "다른 명령" }));
    expect(ephemeralText(res.json)).toBe(MESSAGES.unknown);
  });
});

describe("정글5에 올리기 refusals (no post is created)", () => {
  const { fn, calls } = mockFetch();
  const app = makeApp({ fetch: fn });
  let user: TestUser;
  beforeAll(async () => {
    user = await login(app);
  });

  const refusal = async (payload: unknown) => {
    const res = await signedCall(app, payload);
    expect(res.status).toBe(200);
    return ephemeralText(res.json);
  };

  it("someone else's message → refused", async () => {
    expect(await refusal(messageCommand({ invoker: user.discordUserId, author: "123456789012345678" }))).toBe(MESSAGES.notAuthor);
  });

  it("no, too large or multiple HTML attachments → refused", async () => {
    const inv = user.discordUserId;
    expect(await refusal(messageCommand({ invoker: inv, attachments: [] }))).toBe(MESSAGES.noHtml);
    expect(await refusal(messageCommand({ invoker: inv, attachments: [{ filename: "a.png", size: 10 }] }))).toBe(MESSAGES.noHtml);
    expect(
      await refusal(messageCommand({ invoker: inv, attachments: [{ filename: "a.html", size: LIMITS.htmlMaxBytes + 1 }] })),
    ).toBe(MESSAGES.tooLarge);
    expect(
      await refusal(
        messageCommand({ invoker: inv, attachments: [{ filename: "a.html", size: 10 }, { filename: "b.HTM", size: 10 }] }),
      ),
    ).toBe(MESSAGES.multipleHtml);
  });

  it("an invoker who never logged in, left the guild or withdrew → asked to log in", async () => {
    expect(await refusal(messageCommand({ invoker: "111111111111111111" }))).toBe(MESSAGES.notMember);
    const leaver = await login(app);
    await env.DB.prepare("UPDATE members SET is_guild_member = 0 WHERE id = ?").bind(leaver.memberId).run();
    expect(await refusal(messageCommand({ invoker: leaver.discordUserId }))).toBe(MESSAGES.notMember);
    const quitter = await login(app);
    expect((await call(app, "DELETE", "/api/me", { cookie: quitter.cookie })).status).toBe(204);
    expect(await refusal(messageCommand({ invoker: quitter.discordUserId }))).toBe(MESSAGES.notMember);
    expect(MESSAGES.notMember).toBe("먼저 https://jungle5.xyz 에 로그인해 주세요");
  });

  it("another guild → refused", async () => {
    expect(await refusal(messageCommand({ invoker: user.discordUserId, guildId: "1" }))).toBe(MESSAGES.wrongGuild);
  });

  it("made no network calls and no posts", async () => {
    expect(calls).toEqual([]);
    expect(await postsBy(user.memberId)).toEqual([]);
  });
});

describe("정글5에 올리기 success path", () => {
  const html = "<!doctype html><html><head><title> 트랜잭션 &amp; 격리 수준 </title></head><body><p>내용</p></body></html>";

  it("defers ephemerally, creates the post (category 기타) + HTML, edits the original, then posts publicly", async () => {
    const { fn, calls } = mockFetch({ [CDN]: html });
    const app = makeApp({ fetch: fn });
    const user = await login(app);
    const payload = messageCommand({ invoker: user.discordUserId, attachments: [{ filename: "isolation.html", size: 120 }] });
    const res = await signedCall(app, payload);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ type: 5, data: { flags: 64 } });

    const rows = await postsBy(user.memberId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      title: "트랜잭션 & 격리 수준",
      category_id: SEED_CATEGORY_ID,
      filename: "isolation.html",
      html,
      size: new TextEncoder().encode(html).length,
      uploaded_via: "discord",
      discord_message_id: payload.data.target_id,
    });
    expect(row.body).toContain("Discord에서 올린 HTML입니다.");
    expect(String(row.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const link = `${ORIGIN}/posts/${String(row.id)}`;

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${CDN}`,
      `PATCH https://discord.com/api/v10/webhooks/${APP_ID}/interaction-token-abc/messages/@original`,
      `POST https://discord.com/api/v10/webhooks/${APP_ID}/interaction-token-abc`,
    ]);
    const edit = JSON.parse(calls[1]!.body);
    expect(edit).toEqual({
      content: `등록했습니다. 카테고리·태그는 사이트에서 바꿀 수 있어요: ${link}`,
      allowed_mentions: { parse: [] },
    });
    const followUp = JSON.parse(calls[2]!.body);
    expect(followUp).toEqual({
      content: `📄 트랜잭션 & 격리 수준 — 정글5에서 보기: ${link}`,
      allowed_mentions: { parse: [] },
    });
    expect(followUp).not.toHaveProperty("flags"); // public

    // The post is a normal post on the site, with its HTML metadata.
    const detail = await call(app, "GET", `/api/posts/${String(row.id)}`, { cookie: user.cookie });
    expect(detail.json.html).toMatchObject({ filename: "isolation.html" });
    expect(detail.json.category.name).toBe("기타");
  });

  it("falls back to the file name for the title", async () => {
    const { fn } = mockFetch({ [CDN]: "<p>no title</p>" });
    const app = makeApp({ fetch: fn });
    const user = await login(app);
    await signedCall(app, messageCommand({ invoker: user.discordUserId, attachments: [{ filename: "DDIA 7장.htm", size: 15 }] }));
    expect((await postsBy(user.memberId))[0]).toMatchObject({ title: "DDIA 7장", filename: "DDIA 7장.htm" });
  });

  it("the same message again → the existing link, no second post", async () => {
    const { fn, calls } = mockFetch({ [CDN]: html });
    const app = makeApp({ fetch: fn });
    const user = await login(app);
    const payload = messageCommand({ invoker: user.discordUserId });
    await signedCall(app, payload);
    const [first] = await postsBy(user.memberId);
    const again = await signedCall(app, payload);
    expect(ephemeralText(again.json)).toBe(`이미 올린 메시지예요: ${ORIGIN}/posts/${String(first!.id)}`);
    expect(await postsBy(user.memberId)).toHaveLength(1);
    expect(calls.filter((c) => c.url === CDN)).toHaveLength(1);
  });

  it("non-UTF-8 content → the ephemeral original says so; no post", async () => {
    const { fn, calls } = mockFetch({ [CDN]: new Uint8Array([0x3c, 0x70, 0x3e, 0xff, 0xfe, 0x00]) });
    const app = makeApp({ fetch: fn });
    const user = await login(app);
    const res = await signedCall(app, messageCommand({ invoker: user.discordUserId }));
    expect(res.json.type).toBe(5);
    expect(await postsBy(user.memberId)).toEqual([]);
    const edit = calls.find((c) => c.method === "PATCH");
    expect(JSON.parse(edit!.body).content).toBe(MESSAGES.notUtf8);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("an attachment URL on another host is never fetched", async () => {
    const evil = "https://evil.example/page.html";
    const { fn, calls } = mockFetch({ [evil]: html });
    const app = makeApp({ fetch: fn });
    const user = await login(app);
    await signedCall(app, messageCommand({ invoker: user.discordUserId, attachments: [{ filename: "a.html", size: 10, url: evil }] }));
    expect(calls.some((c) => c.url.startsWith("https://evil.example"))).toBe(false);
    expect(await postsBy(user.memberId)).toEqual([]);
    expect(JSON.parse(calls.find((c) => c.method === "PATCH")!.body).content).toBe(MESSAGES.failed);
  });

  it("a download larger than declared is refused", async () => {
    const { fn, calls } = mockFetch({ [CDN]: "a".repeat(LIMITS.htmlMaxBytes + 1) });
    const app = makeApp({ fetch: fn });
    const user = await login(app);
    await signedCall(app, messageCommand({ invoker: user.discordUserId, attachments: [{ filename: "a.html", size: 10 }] }));
    expect(await postsBy(user.memberId)).toEqual([]);
    expect(JSON.parse(calls.find((c) => c.method === "PATCH")!.body).content).toBe(MESSAGES.tooLarge);
  });

  it("a CDN failure → Korean error in the ephemeral original", async () => {
    const { fn, calls } = mockFetch({}, { [CDN]: 500 });
    const app = makeApp({ fetch: fn });
    const user = await login(app);
    await signedCall(app, messageCommand({ invoker: user.discordUserId }));
    expect(await postsBy(user.memberId)).toEqual([]);
    expect(JSON.parse(calls.find((c) => c.method === "PATCH")!.body).content).toBe(MESSAGES.failed);
  });

  it("a failing public follow-up keeps the post", async () => {
    const calls: string[] = [];
    const f = ((input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      calls.push(`${req.method} ${req.url}`);
      if (req.url === CDN) return Promise.resolve(new Response(html));
      if (req.method === "POST") return Promise.resolve(new Response("{}", { status: 500 })); // the follow-up
      return Promise.resolve(Response.json({}));
    }) as typeof fetch;
    const app = makeApp({ fetch: f });
    const user = await login(app);
    await signedCall(app, messageCommand({ invoker: user.discordUserId }));
    expect(await postsBy(user.memberId)).toHaveLength(1);
    expect(calls.map((c) => c.split(" ")[0])).toEqual(["GET", "PATCH", "POST"]);
  });
});

describe("POST /api/admin/discord/commands", () => {
  it("admins register the guild message command with a client-credentials token", async () => {
    const { fn, calls } = mockFetch();
    const app = makeApp({ fetch: fn });
    const admin = await login(app, { isAdmin: true });
    const res = await call(app, "POST", "/api/admin/discord/commands", { cookie: admin.cookie, body: {} });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ command: { id: "999", name: COMMAND, type: 3, guildId: GUILD_ID } });

    expect(calls).toHaveLength(2);
    const [token, register] = calls;
    expect(token!.url).toBe("https://discord.com/api/v10/oauth2/token");
    expect(token!.headers.get("Authorization")).toBe(`Basic ${btoa(`${APP_ID}:${env.DISCORD_CLIENT_SECRET}`)}`);
    expect(Object.fromEntries(new URLSearchParams(token!.body))).toEqual({
      grant_type: "client_credentials",
      scope: "applications.commands.update",
    });
    expect(`${register!.method} ${register!.url}`).toBe(
      `POST https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`,
    );
    expect(register!.headers.get("Authorization")).toBe("Bearer cc-token");
    expect(JSON.parse(register!.body)).toEqual({ name: COMMAND, type: 3, contexts: [0], integration_types: [0] });
  });

  it("non-admins → 403, anonymous → 401, no Discord calls", async () => {
    const { fn, calls } = mockFetch();
    const app = makeApp({ fetch: fn });
    const member = await login(app);
    expect((await call(app, "POST", "/api/admin/discord/commands", { cookie: member.cookie, body: {} })).status).toBe(403);
    expect((await call(app, "POST", "/api/admin/discord/commands", { body: {} })).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("a Discord error → 503 DISCORD_UNAVAILABLE with the status", async () => {
    const { fn } = mockFetch({}, { "https://discord.com/api/v10/oauth2/token": 401 });
    const app = makeApp({ fetch: fn });
    const admin = await login(app, { isAdmin: true });
    const res = await call(app, "POST", "/api/admin/discord/commands", { cookie: admin.cookie, body: {} });
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("DISCORD_UNAVAILABLE");
    expect(res.json.error.message).toContain("401");
  });
});
