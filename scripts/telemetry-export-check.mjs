// Built standalone server, telemetry on, local HTTPS capture.
// Proves the probe filter in the bundles CI actually ships.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const appPort = Number(process.env.APP_PORT ?? 3457);
const capturePort = Number(process.env.CAPTURE_PORT ?? 3458);
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://wandervibe:wandervibe@127.0.0.1:5432/wandervibe";
const instrumentationKey = "11111111-2222-4333-8444-555555555555";

const envelopes = [];
let app = null;

function fail(message) {
  console.error(message);
  if (app) {
    const output = Buffer.concat(app.chunks).toString("utf8");
    console.error(output.slice(-4000));
  }
  const interesting = envelopes.filter((envelope) =>
    ["RequestData", "RemoteDependencyData", "MessageData"].includes(
      envelope.data?.baseType,
    ),
  );
  console.error(JSON.stringify(interesting.slice(-40), null, 2));
  process.exitCode = 1;
  throw new Error(message);
}

function textOf(envelope) {
  return JSON.stringify(envelope);
}

function ofType(baseType) {
  return envelopes.filter((envelope) => envelope.data?.baseType === baseType);
}

function operationId(envelope) {
  return envelope.tags?.["ai.operation.id"] ?? "";
}

function requestName(envelope) {
  return String(envelope.data?.baseData?.name ?? "");
}

function responseCode(envelope) {
  return String(envelope.data?.baseData?.responseCode ?? "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, predicate, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await sleep(250);
  }
  fail(`Timed out waiting for ${label}`);
}

function startCapture() {
  const dir = mkdtempSync(join(tmpdir(), "wv-telemetry-"));
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  const server = createHttpsServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        let body = Buffer.concat(chunks);
        const encoding = request.headers["content-encoding"];
        if (encoding === "gzip") body = gunzipSync(body);
        const text = body.toString("utf8").trim();
        let count = 0;
        if (text) {
          try {
            const parsed = JSON.parse(text);
            const batch = Array.isArray(parsed) ? parsed : [parsed];
            count = batch.length;
            envelopes.push(...batch);
          } catch {
            envelopes.push({ unparsed: text.slice(0, 500) });
            count = 1;
          }
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            itemsReceived: count,
            itemsAccepted: count,
            errors: [],
          }),
        );
      });
    },
  );
  server.on("tlsClientError", (error) => {
    console.error("capture tls error", error.message);
  });
  return new Promise((resolve) => {
    server.listen(capturePort, "127.0.0.1", () => resolve(server));
  });
}

function startApp(database) {
  const chunks = [];
  const child = spawn(process.execPath, [".next/standalone/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(appPort),
      DATABASE_URL: database,
      AUTH_SECRET:
        process.env.AUTH_SECRET ?? "ci-telemetry-auth-secret-not-a-real-key",
      AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID ?? "ci-google-client",
      AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET ?? "ci-google-secret",
      APPLICATIONINSIGHTS_CONNECTION_STRING: `InstrumentationKey=${instrumentationKey};IngestionEndpoint=https://127.0.0.1:${capturePort}`,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      OTEL_BSP_SCHEDULE_DELAY: "300",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stderr.on("data", (chunk) => chunks.push(chunk));
  return { child, chunks };
}

function stopApp(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function waitForHttp(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 503) return;
    } catch {
      // The server is still starting.
    }
    await sleep(250);
  }
  fail(`Timed out waiting for ${url}`);
}

async function call(path, headers) {
  const response = await fetch(`http://127.0.0.1:${appPort}${path}`, {
    headers,
  });
  await response.arrayBuffer();
  return response.status;
}

function probeExports() {
  return envelopes.filter((envelope) => {
    const baseType = envelope.data?.baseType;
    if (
      baseType !== "RequestData" &&
      baseType !== "RemoteDependencyData" &&
      baseType !== "MessageData"
    ) {
      return false;
    }
    const text = textOf(envelope);
    return (
      text.includes("/api/health") ||
      text.includes("/api/ready") ||
      text.includes("SELECT 1") ||
      text.includes("Readiness check failed")
    );
  });
}

const capture = await startCapture();
const logs = [];
try {
  app = startApp(databaseUrl);
  app.child.stdout.on("data", (chunk) => logs.push(chunk));
  app.child.stderr.on("data", (chunk) => logs.push(chunk));
  await waitForHttp(`http://127.0.0.1:${appPort}/api/health`);

  const signIn = await fetch(`http://127.0.0.1:${appPort}/signin`);
  const signInHtml = await signIn.text();
  if (!signInHtml.includes("Sign in")) fail("Sign-in page did not render");
  await sleep(1500);
  envelopes.length = 0;
  const healthStatus = await call("/api/health", {
    "user-agent": "kube-probe/1.25",
  });
  const readyStatus = await call("/api/ready", {
    "user-agent": "kube-probe/1.25",
  });
  if (healthStatus !== 200) {
    fail(`kube-probe /api/health returned ${healthStatus}`);
  }
  if (readyStatus !== 200) {
    fail(`kube-probe /api/ready returned ${readyStatus}`);
  }
  await sleep(1500);
  const leaked = probeExports();
  if (leaked.length > 0) {
    console.error(
      leaked.map((envelope) => ({
        type: envelope.data?.baseType,
        name: envelope.data?.baseData?.name,
        span: envelope.data?.baseData?.properties?.["next.span_type"],
        code: envelope.data?.baseData?.responseCode,
      })),
    );
    fail("A successful kube-probe exported telemetry");
  }

  envelopes.length = 0;
  const manualStatus = await call("/api/ready", { "user-agent": "curl/8.5.0" });
  if (manualStatus !== 200) fail(`manual /api/ready returned ${manualStatus}`);
  await waitFor("manual readiness export", () =>
    ofType("RemoteDependencyData").some((envelope) =>
      textOf(envelope).includes("SELECT 1"),
    ),
  );
  if (
    !ofType("RequestData").some(
      (envelope) =>
        requestName(envelope).includes("/api/ready") &&
        responseCode(envelope) === "200",
    )
  ) {
    fail("A manual /api/ready did not export its request");
  }

  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  envelopes.length = 0;
  await call("/api/health", {
    "user-agent": "kube-probe/1.25",
    traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
  });
  await sleep(500);
  const reused = await call("/signin", {
    "user-agent": "curl/8.5.0",
    traceparent: `00-${traceId}-b7ad6b7169203331-01`,
  });
  if (reused !== 200) fail(`/signin returned ${reused}`);
  await waitFor("reused traceparent", () =>
    ofType("RequestData").some(
      (envelope) =>
        requestName(envelope).includes("/signin") &&
        operationId(envelope) === traceId,
    ),
  );

  await stopApp(app.child);
  app = startApp("postgresql://wandervibe:wandervibe@127.0.0.1:1/none");
  envelopes.length = 0;
  await waitForHttp(`http://127.0.0.1:${appPort}/api/health`);
  const failed = await call("/api/ready", { "user-agent": "kube-probe/1.25" });
  if (failed !== 503) {
    fail(`kube-probe /api/ready with no database returned ${failed}`);
  }
  await waitFor(
    "failed probe export",
    () => {
      const failedRequest = ofType("RequestData").some(
        (envelope) =>
          requestName(envelope).includes("/api/ready") &&
          responseCode(envelope) === "503",
      );
      // The driver never sends SELECT 1 when the server refuses the connection.
      const postgres = ofType("RemoteDependencyData").some(
        (envelope) =>
          envelope.data?.baseData?.type === "postgresql" &&
          (envelope.data?.baseData?.name === "pg.connect" ||
            textOf(envelope).includes("SELECT 1")),
      );
      const warning = ofType("MessageData").some((envelope) =>
        textOf(envelope).includes("Readiness check failed"),
      );
      return failedRequest && postgres && warning;
    },
    40,
  );

  if (Buffer.concat(logs).toString("utf8").includes("Date.now()")) {
    fail("Prerender logged Date.now()");
  }
  console.log("telemetry export check passed");
} finally {
  if (app) await stopApp(app.child);
  await new Promise((resolve) => capture.close(resolve));
  if (process.exitCode) process.exit(process.exitCode);
}
