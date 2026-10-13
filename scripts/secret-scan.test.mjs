import { test } from "node:test"
import assert from "node:assert/strict"
import { findings } from "./secret-scan.mjs"

test("credential formats are detected with location only and benign references are allowed", () => {
  const samples = [
    ["-----BEGIN " + "PRIVATE KEY-----", "private_pem"],
    ["AK" + "IA" + "A".repeat(16), "aws_access"],
    ["gh" + "p_" + "a".repeat(36), "github_token"],
    ["GO" + "CSPX-" + "a".repeat(32), "google_client_secret"],
    ["1/" + "/" + "a".repeat(100), "google_refresh"],
    ["ya" + "29." + "a".repeat(80), "google_access"],
    ['"X-Auth-' + 'Key": "' + "a".repeat(37) + '"', "cloudflare_api_key"],
  ]
  for (const [secret, rule] of samples) {
    assert.deepEqual(findings("line\n" + secret), [{ rule, line: 2 }])
    assert.ok(!JSON.stringify(findings(secret)).includes(secret))
  }
  assert.deepEqual(findings('GMAIL_REFRESH_TOKEN="test-only"\n{"kty":"RSA","n":"public"}\nhttps://example.test'), [])
})
