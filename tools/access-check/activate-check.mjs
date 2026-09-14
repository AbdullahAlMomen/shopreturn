// Task 2, Step 5: complete self-registration activation the way a customer
// would -- by exercising the exact call the /activate landing page makes,
// not `blocks iam users activate` (the admin path, which proves nothing
// about whether a real customer's journey works).
//
// The activation email (from blocks@selise.io, subject "Welcome to Blocks
// Construct") links to:
//   https://dbzjdy.slsblx.com/activate?code=<code>&lang=<locale>
// That is the scaffolded app's own domain, not the IdP -- so this URL is
// only a code carrier. The page behind it is expected to read `code` from
// the query string and call IAM directly, same as this script does.
//
// Run with: node --env-file=.env activate-check.mjs <code>
import { createBlocksClient } from "@seliseblocks/client";
import { CONFIG, signIn } from "./client.mjs";

const code = process.argv[2];
if (!code) {
  throw new Error("Usage: node --env-file=.env activate-check.mjs <activation-code>");
}

const email = process.env.SHOPRETURN_SELFREG_EMAIL;
const password = process.env.SHOPRETURN_SELFREG_PASSWORD;
if (!email || !password) {
  throw new Error("SHOPRETURN_SELFREG_EMAIL / SHOPRETURN_SELFREG_PASSWORD must be set (see .env).");
}

const blocks = createBlocksClient({
  apiUrl: CONFIG.apiUrl,
  xBlocksKey: CONFIG.xBlocksKey
});

console.log("Calling validateActivation({ code }) ...");
try {
  const validateResponse = await blocks.auth.validateActivation({ code });
  console.log("validateActivation response:");
  console.log(JSON.stringify(validateResponse, null, 2));
} catch (error) {
  console.log(`validateActivation threw: ${error.message}`);
}

console.log("Calling activate({ code }) ...");
const activateResponse = await blocks.auth.activate({ code });
console.log("activate response:");
console.log(JSON.stringify(activateResponse, null, 2));

console.log(`Attempting signIn(${email}) ...`);
try {
  const { token } = await signIn(email, password);
  console.log(`signIn succeeded, token length ${token.length}`);
} catch (error) {
  console.log(`signIn FAILED: ${error.message}`);
}
