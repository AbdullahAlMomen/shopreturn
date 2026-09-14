// Task 2, Step 4: prove a real stranger can self-register.
//
// Every user in this project so far was created by an admin and activated
// by an admin -- a path no real customer ever takes. This script exercises
// the actual public signup surface (`blocksClient.auth.signup`, which POSTs
// /iam/v4/auth/signup) the way a stranger hitting a signup form would, using
// a brand-new address that was never seeded or admin-created.
//
// Run with: node --env-file=.env signup-check.mjs
//
// The SDK's `auth.signup(request: Record<string, unknown>)` passes the body
// through unchanged -- IAM owns the payload shape, not the SDK. `login` uses
// `{ username, password }` (see client.mjs), but signup's field names are
// not documented in the SDK; this script tries a first-guess shape and, if
// IAM rejects it, prints IAM's validation error so the accepted shape can be
// read off directly rather than guessed blindly.
import { createBlocksClient } from "@seliseblocks/client";
import { CONFIG } from "./client.mjs";

const email = process.env.SHOPRETURN_SELFREG_EMAIL;
const password = process.env.SHOPRETURN_SELFREG_PASSWORD;

if (!email || !password) {
  throw new Error("SHOPRETURN_SELFREG_EMAIL / SHOPRETURN_SELFREG_PASSWORD must be set (see .env).");
}

const blocks = createBlocksClient({
  apiUrl: CONFIG.apiUrl,
  xBlocksKey: CONFIG.xBlocksKey
});

// First-guess payload: mirrors the login shape (`username`/`password`) plus
// the name fields IAM's user model is known to carry elsewhere in this
// project (users list output shows firstName/lastName). If IAM rejects this
// shape, its error message names the fields it actually wants.
const payload = {
  email,
  username: email,
  password,
  confirmPassword: password,
  firstName: "Selfreg",
  lastName: "Customer"
};

console.log(`Attempting signup for ${email} ...`);
const response = await blocks.auth.signup(payload);
console.log("signup response:");
console.log(JSON.stringify(response, null, 2));
