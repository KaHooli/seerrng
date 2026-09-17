import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectTransportNotice } from './transportNotice';

const status = (
  overrides: Partial<Parameters<typeof selectTransportNotice>[0]> = {}
) => ({
  mode: 'disabled' as const,
  httpAuthAllowed: true,
  pendingRestart: false,
  ...overrides,
});

describe('selectTransportNotice', () => {
  it('reassures rather than warns when a reverse proxy terminates TLS', () => {
    // The built-in listener is legitimately disabled behind a proxy, so the
    // mode alone must not decide: it is the browser's transport that says
    // whether anything is actually unprotected.
    assert.equal(
      selectTransportNotice(status({ httpAuthAllowed: false }), true),
      'proxy-https'
    );
    assert.equal(
      selectTransportNotice(status({ httpAuthAllowed: true }), true),
      'proxy-https-http-auth'
    );
  });

  it('still reports permitted HTTP sign-in to a viewer on HTTPS', () => {
    // Their own cookie is safe, but anyone reaching the server past the proxy
    // can sign in without that protection, so it is not hidden.
    assert.notEqual(
      selectTransportNotice(status({ httpAuthAllowed: true }), true),
      selectTransportNotice(status({ httpAuthAllowed: false }), true)
    );
  });

  it('warns when the browser really is on plain HTTP', () => {
    assert.equal(
      selectTransportNotice(status({ httpAuthAllowed: false }), false),
      'https-required'
    );
    assert.equal(
      selectTransportNotice(status({ httpAuthAllowed: true }), false),
      'insecure-http-auth'
    );
  });

  it('asks for a restart only while the browser cannot reach HTTPS', () => {
    assert.equal(
      selectTransportNotice(status({ pendingRestart: true }), false),
      'restart-required'
    );
    assert.equal(
      selectTransportNotice(status({ pendingRestart: true }), true),
      'proxy-https-http-auth'
    );
  });

  it('reports SeerrNG serving HTTPS itself whatever the browser used', () => {
    for (const mode of ['self-signed', 'provided'] as const) {
      for (const browserUsesHttps of [true, false]) {
        assert.equal(
          selectTransportNotice(status({ mode }), browserUsesHttps),
          'tls-active'
        );
      }
    }
  });
});
