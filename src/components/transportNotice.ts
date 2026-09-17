import type { TlsStatusResponse } from '@server/interfaces/api/settingsInterfaces';

type TransportNoticeStatus = Pick<
  TlsStatusResponse,
  'mode' | 'httpAuthAllowed' | 'pendingRestart'
>;

export type TransportNoticeKind =
  /** A saved transport choice is not active until the server restarts. */
  | 'restart-required'
  /** TLS is terminated upstream; sign-in is already protected. */
  | 'proxy-https'
  /** As above, but direct HTTP sign-in is also still permitted. */
  | 'proxy-https-http-auth'
  /** Plain HTTP, and direct HTTP sign-in is switched off. */
  | 'https-required'
  /** Plain HTTP, with direct HTTP sign-in switched on. */
  | 'insecure-http-auth'
  /** SeerrNG is serving HTTPS itself. */
  | 'tls-active';

/**
 * Chooses which transport notice the login page shows.
 *
 * `status.mode` describes SeerrNG's *own* listener, so it is `disabled` both
 * when nothing protects the connection and when a reverse proxy terminates
 * TLS in front of it. Only the browser knows which of those it is, which is
 * why `browserUsesHttps` decides between the reassuring notices and the
 * warnings rather than the mode alone.
 */
export const selectTransportNotice = (
  status: TransportNoticeStatus,
  browserUsesHttps: boolean
): TransportNoticeKind => {
  if (status.pendingRestart && !browserUsesHttps) {
    return 'restart-required';
  }

  if (status.mode !== 'disabled') {
    return 'tls-active';
  }

  if (browserUsesHttps) {
    // The viewer's own connection is encrypted either way. Allowing direct
    // HTTP sign-in still matters, because anyone reaching the server past the
    // proxy gets none of that protection, so it is reported rather than hidden.
    return status.httpAuthAllowed ? 'proxy-https-http-auth' : 'proxy-https';
  }

  return status.httpAuthAllowed ? 'insecure-http-auth' : 'https-required';
};
