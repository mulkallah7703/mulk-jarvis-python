import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyXFailure, oauthSignature, postTweet, readXCreds, summarizeXError } from "./x-oauth.ts";

describe("x oauth", () => {
  it("matches the documented HMAC-SHA1 signature", () => {
    const signature = oauthSignature(
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json",
      {
        include_entities: "true",
        oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
        oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: "1318622958",
        oauth_token: "370773112-GmHxMUg0t8gN7U9dV2cS9dU",
        oauth_version: "1.0",
        status: "Hello Ladies + Gentlemen, a signed OAuth request!",
      },
      "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    );
    assert.equal(signature, "b7wosNEs79HSNybbc+yEq4nfSR0=");
  });

  it("stays unconfigured until every X env is set", () => {
    assert.equal(readXCreds({}), null);
    assert.equal(readXCreds({ X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c" }), null);
    const creds = readXCreds({
      X_API_KEY: "a",
      X_API_SECRET: "b",
      X_ACCESS_TOKEN: "c",
      X_ACCESS_TOKEN_SECRET: "d",
    });
    assert.deepEqual(creds, { apiKey: "a", apiSecret: "b", accessToken: "c", accessSecret: "d" });
  });

  it("posts to X API v2 and ignores a missing id", async () => {
    let seen = "";
    const ok = await postTweet("hello", {
      apiKey: "consumer-key",
      apiSecret: "consumer-secret-value",
      accessToken: "user-token",
      accessSecret: "user-secret-value",
    }, async (url, init) => {
      assert.equal(url, "https://api.x.com/2/tweets");
      seen = String(init?.body);
      const header = String((init?.headers as { Authorization?: string }).Authorization || "");
      assert.equal(header.startsWith("OAuth "), true);
      assert.equal(header.includes("consumer-secret-value"), false);
      assert.equal(header.includes("user-secret-value"), false);
      return new Response(JSON.stringify({ data: { id: "99" } }), { status: 201 });
    });
    assert.equal(ok.id, "99");
    assert.equal(seen, JSON.stringify({ text: "hello" }));

    await assert.rejects(
      () =>
        postTweet(
          "hello",
          { apiKey: "consumer-key", apiSecret: "consumer-secret-value", accessToken: "user-token", accessSecret: "user-secret-value" },
          async () => new Response("no", { status: 403 }),
        ),
      (error: unknown) => error instanceof Error && error.message === "x status 403 failed",
    );
  });

  it("treats a duplicate 403 as a duplicate, not a bad token", () => {
    const detail = summarizeXError(
      JSON.stringify({ title: "Forbidden", detail: "You are not allowed to create a Tweet with duplicate content.", status: 403 }),
    );
    assert.equal(classifyXFailure(403, detail), "duplicate");
    assert.equal(classifyXFailure(403, summarizeXError(JSON.stringify({ errors: [{ message: "Status is a duplicate.", code: 187 }] }))), "duplicate");
    assert.equal(classifyXFailure(403, "Forbidden"), "failed");
    assert.equal(classifyXFailure(401, "Unauthorized"), "permissions");
    assert.equal(
      classifyXFailure(403, "Your client app is not configured with the appropriate oauth1 app permissions for this endpoint."),
      "permissions",
    );
    assert.equal(classifyXFailure(402, "CreditsDepleted"), "limited");
  });
});
