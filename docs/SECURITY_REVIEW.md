# Mango Security Review

Date: 2026-05-02  
Reviewer role: Security tester  
Scope: `server/`, `ui/`, `desktop/`, `docker/`, and supporting deployment configuration.

## Remediation Status

This document began as a review report. The first hardening pass has now addressed several items:

- README warning added; Docker examples publish only to host loopback.
- Server bind host now defaults to `127.0.0.1`, with `HOST` / `MANGO_HOST` as explicit overrides.
- Open CORS was replaced with an origin allowlist and cross-site fetch rejection.
- The JavaScript console no longer uses `new Function(...)`; it runs in a restricted VM context and can be disabled with `MANGO_DISABLE_JS_CONSOLE=true`.
- MongoDB operations now apply timeouts where the driver supports them.
- MongoDB URI and AI base URL validation were added.
- User-facing connection/provider/command errors are redacted.
- Desktop CSP was added and broad webview shell/process permissions were removed.
- URI redaction was changed from narrow regex-only handling to authority parsing with fallback redaction.

Remaining work is mostly deeper defense-in-depth: a true sandbox/process isolation model for the JavaScript console, optional auth/reverse-proxy guidance for remote deployments, and broader security regression coverage.

## Product Security Assumptions

Mango is a MongoDB management tool, so some high-impact capabilities are intentional product features rather than vulnerabilities by themselves:

- Users can browse, edit, delete, and replace MongoDB documents.
- Users can run MongoDB shell-style commands against connections they configure.
- Mango currently has no user authentication model and is not intended to be publicly exposed.
- The AI assistant is user-configured. Extra data sampling is a user setting and is off by default.

This review therefore focuses on risks caused by implementation choices, unsafe defaults, missing guardrails, or documentation gaps around the intended local/trusted-use model.

## Executive Summary

The biggest security issue is not that Mango can administer databases; that is the product. The issue is that the code and docs do not consistently enforce or communicate the assumed trust boundary.

The server exposes powerful unauthenticated APIs, uses permissive CORS, and does not explicitly bind to loopback. That is dangerous for a local-only tool because a malicious website may be able to drive the local API from the user's browser, and a Docker/dev instance may accidentally become reachable on a LAN. The JavaScript console is also implemented with `new Function(...)`, which means the route can escape from “MongoDB console” behavior into full Node.js process execution.

Highest-priority changes:

1. Clearly document that Mango must not be exposed publicly without a separate auth/reverse-proxy layer.
2. Bind to `127.0.0.1` by default for local/server modes, with an explicit opt-in for network binding.
3. Restrict CORS to known app origins and add CSRF/local request protections.
4. Replace or isolate the JavaScript console implementation.
5. Tighten desktop CSP/permissions and add operational guardrails such as timeouts, redaction, and safer error handling.

## Not Counted As Findings

The following were reviewed but are considered expected product behavior under the stated model:

- Raw read/write database access through the UI.
- Destructive document operations when initiated by the trusted user.
- MongoDB shell/admin capabilities as a feature, provided the app remains local/trusted.
- Lack of first-party user login, provided public exposure is explicitly unsupported and prevented by defaults/docs.
- Optional AI data sampling when the user enables it.

## Findings

### F-001: Public-Exposure Warning and Network-Binding Defaults Are Too Weak

Severity: High  
Likelihood of abuse: Medium  
Affected code/docs:

- `server/src/index.ts:90` starts the server without an explicit `hostname`.
- `docker/Dockerfile:34` exposes port `5180`.
- `README.md` previously described Docker/homelab/k8s use without a clear warning that Mango has no built-in auth and must not be publicly exposed.

Why this is a coding/product-hardening issue:

No authentication is a deliberate design choice, but the runtime defaults and docs should make accidental exposure hard. A local tool should bind to loopback by default unless the operator explicitly chooses remote access.

Impact:

If Mango is reachable from another machine, any network peer can control configured databases and settings. This is especially easy to do accidentally with Docker port publishing, home lab reverse proxies, or Kubernetes ingress examples.

Likelihood of abuse:

Medium. The app is not meant for public deployment, but the Docker and server defaults make accidental LAN or internet exposure plausible.

Remediation:

- Add `HOST` config and default it to `127.0.0.1`.
- Require an explicit `HOST=0.0.0.0` or similar opt-in for network exposure.
- Keep README warnings near Quick Start, Docker, and Aspire sections.
- For container examples, prefer `-p 127.0.0.1:5180:5180`.
- Document that production/public use requires an authenticating reverse proxy, TLS, and network allowlisting.

### F-002: Permissive CORS Allows Malicious Websites to Drive the Local API

Severity: High  
Likelihood of abuse: High  
Affected code:

- `server/src/index.ts:43` applies `cors()` to every `/api/*` route.
- `server/src/index.ts:53-64` mounts all privileged API routes under that permissive CORS policy.

Why this is a coding issue:

Even for a local-only unauthenticated app, browser-origin protections matter. A malicious website loaded in the user's browser can target `http://localhost:5180` or the desktop sidecar port. With permissive CORS, browser JavaScript can read responses as well as send state-changing requests.

Impact:

A hostile page can enumerate connections, read collection data, modify documents, delete documents, change AI settings, or invoke console/shell routes if it can reach the local server.

Likelihood of abuse:

High for users who run Mango while browsing untrusted sites. Localhost-targeting attacks are common enough that CORS/CSRF should be treated as part of the local threat model.

Remediation:

- Replace default `cors()` with an explicit allowlist:
  - Vite dev origin, e.g. `http://localhost:5173`.
  - The bundled app origin/loopback port used by desktop.
  - Optional configured origins for advanced deployments.
- Require a non-simple custom header or local bearer token for mutating routes.
- Consider SameSite/CSRF protections if cookies are introduced later.
- Reject requests with unexpected `Origin`, `Referer`, or `Sec-Fetch-Site` values where practical.

### F-003: JavaScript Console Escapes the Intended MongoDB Abstraction

Severity: Critical  
Likelihood of abuse: Medium  
Affected code:

- `server/src/routes/console.ts:123-132` notes that `globalThis` is reachable.
- `server/src/routes/console.ts:149-170` runs user-provided code with `new Function(...)`.
- `server/src/routes/console.ts:229-244` exposes that evaluator through HTTP.

Why this is a coding issue:

A MongoDB management console is an expected feature. Full Node.js process execution is not. The proxy limits access to the `db` object, but it does not sandbox JavaScript. The evaluated code can reach the JavaScript global scope and may access process state, dynamic imports, filesystem APIs, or child process APIs.

Impact:

If the route is abused, this becomes server-side code execution in the Mango process. That can expose environment variables, local files, AI credentials, master keys, and database credentials available to the process.

Likelihood of abuse:

Medium under the intended local/trusted model, but high if combined with F-001 or F-002.

Remediation:

- Replace `new Function(...)` with a parser for a supported Mongo command subset.
- If arbitrary JavaScript must remain, run it in a separate sandboxed process/container with:
  - No inherited environment secrets.
  - No host filesystem access.
  - No network except the selected MongoDB target.
  - CPU, memory, and wall-clock limits.
- Disable the JavaScript console by default in Docker/Aspire modes unless explicitly enabled.
- Add tests proving console commands cannot access `globalThis.process`, dynamic imports, filesystem, or child processes.

### F-004: Desktop Webview Has No CSP and Broad Shell/Process Permissions

Severity: High  
Likelihood of abuse: Low to Medium  
Affected code:

- `desktop/src-tauri/tauri.conf.json:24-26` sets `"csp": null`.
- `desktop/src-tauri/capabilities/default.json:6-12` grants shell execute/spawn/kill, process defaults, and opener defaults to the main window.
- `desktop/src-tauri/src/lib.rs:86-91` uses `window.eval(...)` to navigate to the local server.

Why this is a coding issue:

The current UI generally renders database values as React text, but desktop apps should be hardened against future XSS bugs, dependency bugs, or unsafe rendering regressions. Broad Tauri permissions turn a webview compromise into a much larger local compromise.

Impact:

An XSS in the desktop UI could potentially invoke shell/process capabilities or pivot into the local sidecar API.

Likelihood of abuse:

Low today based on visible UI rendering patterns, but medium over time as features and dependencies change.

Remediation:

- Add a strict CSP for the bundled UI.
- Remove generic `shell:allow-execute` and `shell:allow-spawn` from the webview if the frontend does not need them.
- Scope shell permissions to only the sidecar startup path handled by Rust, not arbitrary webview calls.
- Prefer a Tauri navigation API over `window.eval(...)` if available.
- Add tests around rendering untrusted document values.

### F-005: Arbitrary Outbound Targets Enable SSRF-Like Probing and Provider-Key Exfiltration

Severity: Medium  
Likelihood of abuse: Medium  
Affected code:

- `server/src/routes/connections.ts:95-107` accepts arbitrary MongoDB URIs and attempts server-side connections.
- `server/src/routes/ai.ts:65-82` accepts arbitrary AI `baseUrl` and stores it.
- `server/src/providers/openai.ts:44`, `server/src/providers/openai.ts:68`, and `server/src/providers/openai.ts:135` send requests to the configured base URL.

Why this is a coding issue:

Configurable targets are useful, but the app should validate schemes and make risky destination changes explicit. The most concerning case is an attacker-controlled AI-compatible endpoint receiving a stored API key and schema/prompt payloads.

Impact:

An attacker who can access the API can make the Mango host connect to internal network addresses, attacker-controlled MongoDB endpoints, or attacker-controlled OpenAI-compatible endpoints.

Likelihood of abuse:

Medium. This depends on API access, but F-001/F-002 make that realistic enough to address.

Remediation:

- Validate MongoDB URI schemes and reject unsupported protocols.
- For AI `baseUrl`, require `https://` by default unless the user explicitly enables local/insecure endpoints.
- Add an allowlist option for enterprise/shared deployments.
- Require explicit confirmation before sending an existing stored API key to a newly changed base URL.
- Return normalized connection-test errors rather than raw network/driver detail.

### F-006: Expensive Operations Lack Timeouts and Response-Size Guardrails

Severity: Medium  
Likelihood of abuse: Medium  
Affected code:

- `server/src/routes/documents.ts:60-68` runs filters/sorts and `countDocuments(filter)` without `maxTimeMS`.
- `server/src/routes/shell.ts:27` forwards arbitrary MongoDB commands without timeouts.
- `server/src/routes/console.ts:149-170` can execute CPU-bound JavaScript indefinitely.
- `server/src/routes/console.ts:10-14` allows 50,000-character commands and result limits up to 2,000.

Why this is a coding issue:

Trusted database tools still need operational guardrails. A typo, malicious local page, or expensive query can degrade the Mango server and the backing MongoDB.

Impact:

Denial of service against Mango, high MongoDB load, event-loop blocking, memory pressure, and large responses.

Likelihood of abuse:

Medium. Accidental expensive queries are likely in normal use; malicious abuse becomes easier with F-002.

Remediation:

- Add request body size limits.
- Use MongoDB `maxTimeMS` on find/count/aggregate/distinct/command operations where supported.
- Add response size caps.
- Add rate limits for high-risk routes.
- Move console execution into an interruptible worker/process.

### F-007: Raw Error Messages Leak Internal Details

Severity: Medium  
Likelihood of abuse: Medium  
Affected code:

- `server/src/routes/connections.ts:85-87` and `server/src/routes/connections.ts:109-112` return raw connection errors.
- `server/src/routes/shell.ts:31-38` returns raw command errors.
- `server/src/routes/ai.ts:169-217` returns raw provider errors.
- `server/src/schema-sampling.ts:118-121` includes sampling errors in generated schema text.

Why this is a coding issue:

Detailed errors are useful in a developer tool, but raw upstream errors can disclose hostnames, ports, TLS modes, auth behavior, provider details, and sometimes sensitive request fragments. The UI can still show useful diagnostics without returning unredacted internals.

Impact:

Attackers can use errors to map internal services, tune connection attempts, or learn provider configuration details.

Likelihood of abuse:

Medium, especially through connection testing and AI provider configuration.

Remediation:

- Return stable public error codes and concise user-facing messages.
- Log full details server-side with secret redaction.
- Redact credentials, API keys, tokens, internal IPs, and hostnames before returning errors.
- Consider a developer diagnostics mode for local-only detailed output.

### F-008: MongoDB URI Redaction Uses a Narrow Regex

Severity: Low  
Likelihood of abuse: Low  
Affected code:

- `server/src/store/crypto.ts:83-90` redacts MongoDB URIs with a regex.

Why this is a coding issue:

URI parsing is tricky. Regex redaction can miss valid edge cases such as encoded delimiters, unusual usernames/passwords, multiple hosts, or malformed-but-stored values.

Impact:

`uriRedacted` responses could accidentally reveal more credential or environment information than intended.

Likelihood of abuse:

Low, because connection details are already exposed only to whoever can access the local API. It is still a worthwhile hardening fix.

Remediation:

- Use structured URI parsing rather than regex.
- Always blank the password component.
- Consider redacting usernames as well.
- Add tests for encoded credentials, SRV URIs, multiple hosts, empty usernames, malformed URIs, and query-string credential edge cases.

## Positive Observations

- MongoDB connection URIs and AI settings are encrypted at rest with AES-256-GCM in `server/src/store/crypto.ts`.
- SQL access uses prepared statements in the SQLite store.
- Normal document search limits result size (`limit` max 500).
- React generally renders database values as text; no `dangerouslySetInnerHTML` use was found in `ui/src`.
- The AI distinct-value sampling setting is off by default.
- Standalone mode disables connection management mutations, reducing accidental reconfiguration in Aspire/Docker single-connection setups.

## Recommended Remediation Plan

### Immediate

1. Add a prominent README warning that Mango has no built-in user auth and must not be publicly exposed.
2. Default server binding to `127.0.0.1`; require explicit opt-in for `0.0.0.0`.
3. Replace permissive CORS with an origin allowlist.
4. Disable or isolate `/console` outside trusted local development.
5. Add clear Docker examples using loopback port publishing.

### Short Term

1. Replace `new Function(...)` console execution with a validated command subset or sandboxed worker.
2. Add `maxTimeMS`, request-size limits, response-size caps, and rate limits.
3. Normalize and redact client-facing errors.
4. Harden AI `baseUrl` changes and Mongo URI validation.
5. Add CSP and reduce Tauri shell/process permissions.

### Medium Term

1. Add an optional auth/reverse-proxy deployment guide for users who need remote access.
2. Add security regression tests for CORS/origin checks, console sandboxing, redaction, and URI validation.
3. Add a safe diagnostics mode that can show detailed local errors without exposing raw details by default.

## Security Test Cases to Add

- Requests from unexpected browser origins cannot read API responses.
- Mutating routes reject missing local token/custom header if that protection is added.
- Docker documentation uses loopback publishing by default.
- `/console` cannot access `globalThis.process`, dynamic imports, filesystem, or child processes.
- Expensive queries and commands are capped by `maxTimeMS` or route-level timeouts.
- Connection and provider errors are redacted.
- URI redaction covers encoded credentials and unusual valid MongoDB URI forms.
