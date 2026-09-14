import { createBlocksClient } from "@seliseblocks/client";

export const CONFIG = {
  apiUrl: "https://api.seliseblocks.com",
  xBlocksKey: "Df53833214f2a4243b696b55040b32509"
};

/**
 * Signs in with username/password and returns a client bound to that session.
 * The SDK does not store tokens, so the caller owns them — which is what lets
 * this harness hold four independent sessions at once.
 */
export async function signIn(email, password) {
  let token;
  const blocks = createBlocksClient({
    apiUrl: CONFIG.apiUrl,
    xBlocksKey: CONFIG.xBlocksKey,
    accessToken: () => token
  });

  // The installed SDK's BlocksAuthLoginRequest type (and the compiled
  // auth-client.js, which passes the body through unchanged) expects
  // `username`, not `email`. We keep this function's public signature as
  // signIn(email, password) and map email -> username here.
  //
  // Confirmed against a live login: IAM's response uses `access_token`
  // (snake_case), not `accessToken`. No fallback needed.
  const response = await blocks.auth.login({ username: email, password });
  token = response?.access_token;
  if (!token) {
    throw new Error(`login for ${email} returned no access token: ${JSON.stringify(response)}`);
  }
  return { blocks, token };
}
