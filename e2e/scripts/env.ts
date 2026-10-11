/** Ports and URLs shared by the stack launcher, the config and the tests. */
export const SERVER_PORT = Number(process.env.MANGO_E2E_SERVER_PORT ?? 5190);
export const UI_PORT = Number(process.env.MANGO_E2E_UI_PORT ?? 5191);
export const MEMORY_MONGO_PORT = Number(process.env.MANGO_E2E_MEMORY_MONGO_PORT ?? 27317);

export const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
export const UI_URL = `http://127.0.0.1:${UI_PORT}`;

/**
 * MongoDB the stack and the tests talk to. Set MANGO_E2E_MONGO_URL to use an
 * existing instance (CI's service container, a local Docker); otherwise the
 * launcher starts mongodb-memory-server on a fixed port so the tests can
 * reach it without any hand-off.
 */
export const MONGO_URL =
  process.env.MANGO_E2E_MONGO_URL ??
  `mongodb://127.0.0.1:${MEMORY_MONGO_PORT}/?directConnection=true`;
export const USES_MEMORY_SERVER = !process.env.MANGO_E2E_MONGO_URL;

/** Database the suite seeds and mutates. Never points at user data. */
export const DEMO_DB = "mango_e2e";
export const OTHER_DB = "mango_e2e_other";
