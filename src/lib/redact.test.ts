import { expect, test } from "vitest";
import { redactExportedSpan, scrubString, scrubValue } from "./redact";

test("scrub keeps ordinary text and removes secrets from strings", () => {
  const password = "hunter2-password";
  const token = "session-token-value";
  const email = "marc@example.com";
  const code = "oauth-code-value";
  const text = [
    "Readiness check failed",
    "SELECT 1",
    "https://app.example/api/ready",
    `failed for ${email}`,
    `password=${password}`,
    `token=${token}`,
    `Bearer ${token}`,
    `InstrumentationKey=${token};IngestionEndpoint=https://eastus.example`,
    `postgresql://wandervibe:${password}@db.example:5432/wandervibe`,
    `https://app.example/api/auth/callback/google?code=${code}&state=${token}`,
    "authjs.session-token=cookie-secret-value",
    "eyJhbGciOiJIUzI1NiJ9.payloadvalue.signaturevalue",
  ].join(" ");

  const scrubbed = scrubString(text);

  expect(scrubbed).toContain("Readiness check failed");
  expect(scrubbed).toContain("SELECT 1");
  expect(scrubbed).toContain("https://app.example/api/ready");
  expect(scrubbed).toContain("/api/auth/callback/google");
  expect(scrubbed).not.toContain(password);
  expect(scrubbed).not.toContain(token);
  expect(scrubbed).not.toContain(email);
  expect(scrubbed).not.toContain(code);
  expect(scrubbed).not.toContain("cookie-secret-value");
  expect(scrubbed).not.toContain("payloadvalue");
  expect(scrubbed).not.toContain("IngestionEndpoint");
  expect(scrubbed).not.toContain("db.example");
});

test("exported spans keep the SQL text and drop secrets", () => {
  const span = {
    name: "GET /api/auth/callback/google?code=oauth-code-value",
    attributes: {
      "db.query.text": "SELECT 1",
      "server.address": "db.example",
      "url.full":
        "https://app.example/api/auth/callback/google?code=oauth-code-value&email=marc@example.com",
      "http.request.header.cookie": "authjs.session-token=cookie-secret-value",
      "http.request.header.authorization": "Bearer bearer-secret-value",
      password: "hunter2-password",
      "user.email": "other@example.com",
    },
    events: [
      {
        attributes: {
          "exception.message":
            "login failed for marc@example.com password=hunter2-password",
        },
      },
    ],
    status: { message: "token=session-token-value" },
  };

  redactExportedSpan(span);

  expect(span.attributes["db.query.text"]).toBe("SELECT 1");
  expect(span.attributes["server.address"]).toBe("db.example");
  expect(span.name).toContain("/api/auth/callback/google");
  expect(span.name).not.toContain("oauth-code-value");
  const encoded = JSON.stringify(span);
  expect(encoded).not.toContain("oauth-code-value");
  expect(encoded).not.toContain("marc@example.com");
  expect(encoded).not.toContain("other@example.com");
  expect(encoded).not.toContain("cookie-secret-value");
  expect(encoded).not.toContain("bearer-secret-value");
  expect(encoded).not.toContain("hunter2-password");
  expect(encoded).not.toContain("session-token-value");
});

test("scrubs JSON, quoted, encoded, and nested secrets", () => {
  const cases = [
    { input: '{"access_token":"abc123secret"}', secret: "abc123secret" },
    {
      input: 'sessionToken: "opaque-session-value"',
      secret: "opaque-session-value",
    },
    { input: 'password="my secret, pass"', secret: "my secret, pass" },
    {
      input: "Authorization: Basic dXNlcjpwYXNz",
      secret: "dXNlcjpwYXNz",
    },
    { input: "/search?q=marc%40example.com", secret: "marc%40example.com" },
    { input: "/x?%63ode=oauth-code-value", secret: "oauth-code-value" },
    {
      input:
        "/signin?callbackUrl=%2Fapi%2Fauth%2Fcallback%2Fgoogle%3Fcode%3Dnested-code-value",
      secret: "nested-code-value",
    },
  ];

  for (const { input, secret } of cases) {
    expect(scrubString(input), input).not.toContain(secret);
  }

  expect(scrubString('password="my secret, pass"')).not.toContain(
    "secret, pass",
  );
  expect(scrubString("/search?q=marc%40example.com")).not.toContain(
    "marc@example.com",
  );
  expect(
    scrubString('{"refresh_token":"refresh-secret","id_token":"id-secret"}'),
  ).not.toContain("refresh-secret");
  expect(
    scrubString('{"refresh_token":"refresh-secret","id_token":"id-secret"}'),
  ).not.toContain("id-secret");
  expect(scrubString("100% done %")).toContain("100% done");
});

test("scrubs compound keys, spaced passwords, and nested callback secrets", () => {
  const cases = [
    ["client_secret=abc123", "abc123"],
    ["AUTH_GOOGLE_SECRET=gsec", "gsec"],
    ["refresh_token=rt1", "rt1"],
    ['{"access_token":"ya29.secret"}', "ya29.secret"],
    ["access_token: ya29.plain", "ya29.plain"],
    ["x-api-key: sk_live_123", "sk_live_123"],
    ["apikey=abc-key", "abc-key"],
    ["authorization: Basic dXNlcjpwYXNz", "dXNlcjpwYXNz"],
    ["password: hunter 2", "hunter 2"],
    [
      "/signin?callbackUrl=%2Ftrips%3Ftoken%3Dtok-secret-value",
      "tok-secret-value",
    ],
  ] as const;

  for (const [input, secret] of cases) {
    expect(scrubString(input), input).not.toContain(secret);
  }

  const prisma =
    'Invalid `prisma.account.create()` invocation:\n\n{\n  access_token: "ya29.prisma-access",\n  refresh_token: "prisma-refresh"\n}';
  const scrubbed = scrubString(prisma);
  expect(scrubbed).not.toContain("ya29.prisma-access");
  expect(scrubbed).not.toContain("prisma-refresh");
  expect(scrubbed).toContain("prisma.account.create()");
});

test("keeps dates, maps, sets, and error causes", () => {
  const date = new Date("2026-10-31T00:00:00.000Z");
  const error = new Error("failed for marc@example.com");
  error.cause = new Error("password=hunter2-password");
  const value = scrubValue({
    when: date,
    tags: new Set(["ok", "marc@example.com"]),
    meta: new Map([["note", "token=session-token-value"]]),
    err: error,
  });
  const encoded = JSON.stringify(value);

  expect(encoded).toContain("2026-10-31");
  expect(encoded).toContain("ok");
  expect(encoded).toContain("cause");
  expect(encoded).toContain("failed for");
  expect(encoded).not.toContain("marc@example.com");
  expect(encoded).not.toContain("hunter2-password");
  expect(encoded).not.toContain("session-token-value");
});

test("matches secret keys without splitting capitals", () => {
  expect(scrubString("PassWord: MiXeD123")).not.toContain("MiXeD123");
  expect(scrubString("password: MiXeD123")).toContain("[Redacted]");
  const encoded = JSON.stringify(
    scrubValue({ passWord: "mixed-password-value", note: "kept" }),
  );
  expect(encoded).not.toContain("mixed-password-value");
  expect(encoded).toContain("kept");

  const cases = [
    ["secret-key=abc-secret-key", "abc-secret-key"],
    ["session=abc-session-value", "abc-session-value"],
    ["passphrase=abc-passphrase", "abc-passphrase"],
    ["privateKey=abc-private-key", "abc-private-key"],
    ["accessKey=abc-access-key", "abc-access-key"],
  ] as const;
  for (const [input, secret] of cases) {
    expect(scrubString(input), input).not.toContain(secret);
  }
});

test("keeps error codes that are not query secrets", () => {
  expect(scrubString("PostgreSQL error 53300 (code: ECONNREFUSED)")).toContain(
    "ECONNREFUSED",
  );
  expect(scrubString("code: 'P2002'")).toContain("P2002");
  expect(scrubString("/cb?code=oauth-code-value")).not.toContain(
    "oauth-code-value",
  );
  expect(scrubString("/cb?state=oauth-state-value")).not.toContain(
    "oauth-state-value",
  );
});

test("long non-matching strings scrub quickly", () => {
  const inputs = [
    "a".repeat(65536),
    "a.".repeat(32768),
    `/api/${"a".repeat(65536)}`,
  ];
  for (const input of inputs) {
    const started = performance.now();
    const scrubbed = scrubString(input);
    expect(performance.now() - started, input.slice(0, 16)).toBeLessThan(50);
    expect(scrubbed).toContain("…[truncated]");
    expect(scrubbed.length).toBeLessThan(2100);
  }
});
