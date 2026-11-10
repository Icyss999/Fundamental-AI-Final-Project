import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/auth";

/** Every Better Auth endpoint: sign-in/social, callback/github, get-session, sign-out, … */
export const { GET, POST } = toNextJsHandler(auth);
