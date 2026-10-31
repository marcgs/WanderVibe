// @vitest-environment node

import { Writable } from "node:stream";
import { expect, test } from "vitest";
import { createLogger } from "./logger";
import { requestErrorFields } from "./request-error";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, logger: createLogger(stream) };
}

test("structured logs include a request id and omit secrets and personal data", () => {
  const password = "hunter2-password";
  const token = "session-token-value";
  const email = "marc@example.com";
  const nestedEmail = "other@example.com";
  const bearer = "bearer-secret-value";
  const cookie = "cookie-secret-value";
  const instrumentationKey = "instrumentation-key-value";
  const requestId = "11111111-1111-4111-8111-111111111111";
  const { lines, logger } = capture();

  logger.info(
    {
      requestId,
      route: "/api/ready",
      password,
      token,
      email,
      authorization: `Bearer ${bearer}`,
      cookie: `authjs.session-token=${cookie}`,
      connectionString: `InstrumentationKey=${instrumentationKey};IngestionEndpoint=https://eastus.example`,
      user: { email: nestedEmail, name: "Marc" },
    },
    `failed for ${email} password=${password} token=${token}`,
  );

  const output = lines.join("");
  const parsed = JSON.parse(output) as {
    level: string;
    requestId: string;
    route: string;
    msg: string;
  };

  expect(parsed.level).toBe("info");
  expect(parsed.requestId).toBe(requestId);
  expect(parsed.route).toBe("/api/ready");
  expect(parsed.msg).toContain("failed for");
  expect(output).toContain("[Redacted]");
  expect(output).not.toContain(password);
  expect(output).not.toContain(token);
  expect(output).not.toContain(email);
  expect(output).not.toContain(nestedEmail);
  expect(output).not.toContain(bearer);
  expect(output).not.toContain(cookie);
  expect(output).not.toContain(instrumentationKey);
  expect(output).not.toContain("IngestionEndpoint");
});

test("a log line still has a request id when the caller does not pass one", () => {
  const { lines, logger } = capture();

  logger.info("hello");

  const parsed = JSON.parse(lines.join("")) as {
    requestId: string;
    msg: string;
  };
  expect(parsed.msg).toBe("hello");
  expect(parsed.requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("request errors written to the log drop emails, tokens, and header secrets", () => {
  const email = "marc@example.com";
  const cookie = "cookie-secret-value";
  const bearer = "bearer-secret-value";
  const code = "oauth-code-value";
  const fields = requestErrorFields(
    {
      path: `/api/auth/callback/google?code=${code}&email=${email}`,
      method: "GET",
      headers: {
        cookie: `authjs.session-token=${cookie}`,
        authorization: `Bearer ${bearer}`,
        "x-request-id": `session ${cookie}`,
      },
    },
    { routePath: "/api/auth/callback/google" },
  );
  const { lines, logger } = capture();

  logger.error(
    {
      ...fields,
      err: new Error(`sign-in failed for ${email} password=hunter2-password`),
    },
    "Request failed",
  );

  const output = lines.join("");
  expect(output).toContain('"requestId"');
  expect(output).toContain("/api/auth/callback/google");
  expect(output).not.toContain(email);
  expect(output).not.toContain(cookie);
  expect(output).not.toContain(bearer);
  expect(output).not.toContain(code);
  expect(output).not.toContain("hunter2-password");
});
