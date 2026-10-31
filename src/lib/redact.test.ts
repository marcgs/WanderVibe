import { expect, test } from "vitest";
import { redactExportedSpan, scrubString } from "./redact";

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
