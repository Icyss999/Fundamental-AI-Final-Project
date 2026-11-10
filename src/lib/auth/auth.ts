import { createHash, randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { githubOAuthConfigured } from "./config";

/**
 * Better Auth's signing/encryption key. BETTER_AUTH_SECRET wins; otherwise one is derived from the
 * GitHub client secret so a single setup step is enough. Without either, sign-in is impossible
 * anyway, so a throwaway key is fine.
 */
function authSecret(): string {
  const explicit = process.env.BETTER_AUTH_SECRET?.trim();
  if (explicit) return explicit;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (clientSecret) return createHash("sha256").update(`architecture-mapper:${clientSecret}`).digest("hex");
  return randomBytes(32).toString("hex");
}

/**
 * Better Auth with GitHub as the only sign-in method.
 *
 * No database is configured, so Better Auth runs stateless: the session lives in an encrypted (JWE)
 * cookie and the linked GitHub account — including its access token — in an encrypted account
 * cookie. Nothing is stored server-side, and the token never reaches browser JavaScript.
 */
export const auth = betterAuth({
  appName: "Architecture Mapper",
  baseURL: process.env.BETTER_AUTH_URL?.trim() || undefined,
  secret: authSecret(),
  socialProviders: githubOAuthConfigured()
    ? {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID!.trim(),
          clientSecret: process.env.GITHUB_CLIENT_SECRET!.trim(),
          // On top of the defaults (read:user, user:email). OAuth Apps have no read-only scope for
          // private repositories; the app only ever reads (metadata + shallow clone).
          scope: ["repo"],
          mapProfileToUser: (profile) => ({ login: profile.login }),
        },
      }
    : {},
  user: {
    additionalFields: {
      /**
       * GitHub username, for "@login" and the profile link. Display only — never used for access
       * (the token comes from the encrypted account cookie). Not marked `input: false`, because
       * Better Auth then also drops it from the GitHub profile mapping.
       */
      login: { type: "string", required: false },
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 30 },
  // Must stay last: lets auth.api calls in route handlers set cookies through next/headers.
  plugins: [nextCookies()],
});

/** The signed-in user's GitHub access token, or undefined when nobody is signed in. */
export async function getGitHubToken(headers: Headers): Promise<string | undefined> {
  try {
    const { accessToken } = await auth.api.getAccessToken({ body: { useAccountCookie: true }, headers });
    return accessToken || undefined;
  } catch {
    return undefined;
  }
}
