import { createHmac, randomBytes } from "node:crypto";

export type XCreds = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
};

/** OAuth 1.0a user context. Blank until all four server env vars are set. */
export function readXCreds(env: Record<string, string | undefined> = process.env): XCreds | null {
  const apiKey = (env.X_API_KEY || "").trim();
  const apiSecret = (env.X_API_SECRET || "").trim();
  const accessToken = (env.X_ACCESS_TOKEN || "").trim();
  const accessSecret = (env.X_ACCESS_TOKEN_SECRET || "").trim();
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
  return { apiKey, apiSecret, accessToken, accessSecret };
}

export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function oauthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const pairs = Object.keys(params)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(params[key] ?? "")}`)
    .join("&");
  const base = `${method.toUpperCase()}&${encodeRfc3986(url)}&${encodeRfc3986(pairs)}`;
  const key = `${encodeRfc3986(consumerSecret)}&${encodeRfc3986(tokenSecret)}`;
  return createHmac("sha1", key).update(base).digest("base64");
}

export function oauthHeader(
  method: string,
  url: string,
  creds: XCreds,
  extra: Record<string, string> = {},
  nonce = randomBytes(16).toString("hex"),
  timestamp = Math.floor(Date.now() / 1000).toString(),
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const signature = oauthSignature(method, url, { ...extra, ...oauth }, creds.apiSecret, creds.accessSecret);
  oauth.oauth_signature = signature;
  const header = Object.keys(oauth)
    .sort()
    .map((key) => `${encodeRfc3986(key)}="${encodeRfc3986(oauth[key] ?? "")}"`)
    .join(", ");
  return `OAuth ${header}`;
}

export class XApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`x status ${status}`);
    this.name = "XApiError";
    this.status = status;
  }
}

export async function postTweet(text: string, creds: XCreds, fetchImpl: typeof fetch = fetch): Promise<{ id: string }> {
  const url = "https://api.x.com/2/tweets";
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: oauthHeader("POST", url, creds),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new XApiError(response.status);
  const data = (await response.json()) as { data?: { id?: unknown } };
  const id = data.data?.id;
  if (typeof id !== "string" || !id) throw new Error("x status missing id");
  return { id };
}
