declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[]
    DEPLOY_VARS: Record<string, string>
    IMPORT_TEST: D1Database
  }
}
