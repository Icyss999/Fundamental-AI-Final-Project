/** Whether "Sign in with GitHub" can work: both OAuth app credentials must be set. */
export function githubOAuthConfigured(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID?.trim() && process.env.GITHUB_CLIENT_SECRET?.trim());
}
