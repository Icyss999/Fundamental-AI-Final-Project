import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { auth } from "./auth";

/** Browser-side Better Auth client (same origin, default /api/auth base path). */
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>()],
});
