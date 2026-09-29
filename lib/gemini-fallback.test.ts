import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  geminiErrorStatus,
  geminiModelChain,
  isGeminiAuthError,
  shouldFallbackModel,
  thinkingConfig,
} from "./gemini-models.ts";

describe("gemini model chain", () => {
  it("tries the configured model before the fallbacks", () => {
    assert.deepEqual(geminiModelChain("gemini-3.6-flash", "gemini-3.1-flash-lite, gemini-3.5-flash-lite"), [
      "gemini-3.6-flash",
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash-lite",
    ]);
  });

  it("drops duplicates and a blank fallback list", () => {
    assert.deepEqual(geminiModelChain("gemini-3.6-flash", "gemini-3.6-flash, gemini-3.1-flash-lite"), [
      "gemini-3.6-flash",
      "gemini-3.1-flash-lite",
    ]);
    assert.deepEqual(geminiModelChain("gemini-3.6-flash", "   "), ["gemini-3.6-flash"]);
  });

  it("keeps thinking low on gemini-3.6-flash and uses the verified lite settings", () => {
    assert.deepEqual(thinkingConfig("gemini-3.6-flash"), { thinkingLevel: "low" });
    assert.deepEqual(thinkingConfig("gemini-3.1-flash-lite"), { thinkingBudget: 0 });
    assert.deepEqual(thinkingConfig("gemini-3.5-flash-lite"), { thinkingLevel: "minimal" });
    assert.deepEqual(thinkingConfig("gemini-2.5-flash"), { thinkingBudget: 0 });
  });
});

describe("gemini fallback errors", () => {
  it("reads the upstream status from the SDK error", () => {
    const error = Object.assign(new Error("You exceeded your current quota"), { statusCode: 429 });
    assert.equal(geminiErrorStatus(error), 429);
    assert.equal(shouldFallbackModel(error), true);
    assert.equal(isGeminiAuthError(error), false);
  });

  it("falls back on 404 and 5xx, including a status buried in the body", () => {
    assert.equal(shouldFallbackModel({ statusCode: 404, message: "no longer available" }), true);
    assert.equal(shouldFallbackModel({ statusCode: 503, message: "unavailable" }), true);
    const wrapped = {
      message: "Gemini request failed",
      responseBody: JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED" } }),
    };
    assert.equal(geminiErrorStatus(wrapped), 429);
    assert.equal(shouldFallbackModel(wrapped), true);
  });

  it("does not fall back on an invalid key or a bad prompt", () => {
    const denied = Object.assign(new Error("Request had invalid authentication credentials"), { statusCode: 401 });
    assert.equal(isGeminiAuthError(denied), true);
    assert.equal(shouldFallbackModel(denied), false);
    assert.equal(shouldFallbackModel({ statusCode: 400, message: "Request contains an invalid argument." }), false);
  });

  it("treats a quota 403 as a fallback, not a bad key", () => {
    const quota = {
      statusCode: 403,
      message: "Quota exceeded for metric: generate_content_free_tier_requests",
    };
    assert.equal(isGeminiAuthError(quota), false);
    assert.equal(shouldFallbackModel(quota), true);
  });
});
