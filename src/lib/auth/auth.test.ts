import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Minimal browser-like cookie jar for driving Better Auth's handlers. */
function cookieJar() {
  const cookies = new Map<string, string>();
  return {
    update(res: Response) {
      for (const line of res.headers.getSetCookie()) {
        const [pair, ...attrs] = line.split(";");
        const eq = pair.indexOf("=");
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === "";
        if (expired) cookies.delete(name);
        else cookies.set(name, value);
      }
    },
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}

const ORIGIN = "http://localhost:3000";
const githubCalls: string[] = [];

beforeAll(() => {
  process.env.GITHUB_CLIENT_ID = "test-client-id";
  process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
  process.env.BETTER_AUTH_URL = ORIGIN;

  // Stand in for github.com: the code exchange, the profile and the email list.
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://github.com/") || url.startsWith("https://api.github.com/")) githubCalls.push(url.split("?")[0]);
    if (url.startsWith("https://github.com/login/oauth/access_token")) {
      return Response.json({ access_token: "gho_mocked_token", token_type: "bearer", scope: "read:user,user:email,repo" });
    }
    if (url === "https://api.github.com/user") {
      return Response.json({ id: 4242, login: "octo-dev", name: "Octo Dev", email: null, avatar_url: "https://avatars.githubusercontent.com/u/4242" });
    }
    if (url.startsWith("https://api.github.com/user/emails")) {
      return Response.json([{ email: "octo@example.com", primary: true, verified: true, visibility: "private" }]);
    }
    return realFetch(input, init);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
  delete process.env.BETTER_AUTH_URL;
});

describe("Better Auth GitHub sign-in (stateless)", () => {
  it("signs in, exposes the GitHub token only on the server, and signs out", async () => {
    const { auth, getGitHubToken } = await import("./auth");
    const jar = cookieJar();

    // 1. The browser asks to sign in and is sent to GitHub's consent screen.
    const start = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ provider: "github", callbackURL: "/" }),
      }),
    );
    expect(start.status).toBe(200);
    jar.update(start);
    const authorize = new URL((await start.json()).url);
    expect(`${authorize.origin}${authorize.pathname}`).toBe("https://github.com/login/oauth/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("test-client-id");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/github`);
    expect(authorize.searchParams.get("scope")?.split(" ")).toEqual(expect.arrayContaining(["read:user", "user:email", "repo"]));

    // 2. GitHub sends the browser back with a code; Better Auth exchanges it and sets cookies.
    const callback = await auth.handler(
      new Request(`${ORIGIN}/api/auth/callback/github?code=one-time-code&state=${authorize.searchParams.get("state")}`, {
        headers: { cookie: jar.header() },
      }),
    );
    expect(callback.status).toBe(302);
    expect(new URL(callback.headers.get("location")!, ORIGIN).pathname).toBe("/");
    jar.update(callback);
    expect(githubCalls).toEqual(expect.arrayContaining(["https://github.com/login/oauth/access_token", "https://api.github.com/user"]));

    // 3. Server code sees the user and the token; the cookies never hold the token in plain text.
    const headers = new Headers({ cookie: jar.header() });
    const session = await auth.api.getSession({ headers });
    expect(session?.user).toMatchObject({ name: "Octo Dev", login: "octo-dev", image: "https://avatars.githubusercontent.com/u/4242" });
    expect(await getGitHubToken(headers)).toBe("gho_mocked_token");
    expect(jar.header()).not.toContain("gho_mocked_token");

    // 4. A forged state is refused.
    const forged = await auth.handler(new Request(`${ORIGIN}/api/auth/callback/github?code=x&state=forged`, { headers: { cookie: jar.header() } }));
    expect(new URL(forged.headers.get("location")!, ORIGIN).searchParams.get("error")).toMatch(/state/);

    // 5. Signing out clears it all.
    const out = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-out`, { method: "POST", headers: { cookie: jar.header(), origin: ORIGIN, "content-type": "application/json" }, body: "{}" }),
    );
    expect(out.status).toBe(200);
    jar.update(out);
    const after = new Headers({ cookie: jar.header() });
    expect(await auth.api.getSession({ headers: after })).toBeNull();
    expect(await getGitHubToken(after)).toBeUndefined();
  });

  it("has no token for anonymous visitors", async () => {
    const { getGitHubToken } = await import("./auth");
    expect(await getGitHubToken(new Headers())).toBeUndefined();
  });
});
