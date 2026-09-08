import type { Session } from '@server/entity/Session';
import logger from '@server/logger';
import { TypeormStore } from 'connect-typeorm/out';
import type { Store } from 'express-session';
import type { Repository } from 'typeorm';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Builds the session store.
 *
 * connect-typeorm emits `disconnect` from any failed query, and express-session
 * treats that as a latch: it stops attaching `req.session` to every request and
 * only clears the flag on a matching `connect`, which the store emits once, at
 * startup. So a single transient database error locks every user out of every
 * login route — "Session is unavailable." — until the process is restarted.
 *
 * Supplying `onError` replaces that emit, and nothing is lost by it: the store
 * hands each failure to the per-request callback before calling `onError`, so
 * express-session still reports the error to the request that hit it, and the
 * next request retries against the store.
 */
export const createSessionStore = (repository: Repository<Session>): Store =>
  new TypeormStore({
    cleanupLimit: 2,
    ttl: SESSION_TTL_SECONDS,
    onError: (_store, error) => {
      logger.error('Session store query failed', {
        label: 'Server',
        errorMessage: error.message,
      });
    },
  }).connect(repository) as Store;
