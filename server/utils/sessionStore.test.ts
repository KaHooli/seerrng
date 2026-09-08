import type { Session } from '@server/entity/Session';
import logger from '@server/logger';
import express from 'express';
import session from 'express-session';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { getSessionTransportOptions } from './sessionCookie';
import { createSessionStore } from './sessionStore';

const SECRET = '01234567890123456789012345678901';

/** A repository whose every lookup rejects, standing in for a database blip. */
const failingRepository = (error: Error): Repository<Session> => {
  const builder = {
    where: () => builder,
    andWhere: () => builder,
    getOne: () => Promise.reject(error),
  };

  return {
    createQueryBuilder: () => builder,
  } as unknown as Repository<Session>;
};

const failOnce = (store: ReturnType<typeof createSessionStore>) =>
  new Promise<Error | undefined>((resolve) => {
    store.get('some-session-id', (error) => resolve(error ?? undefined));
  });

afterEach(() => {
  mock.restoreAll();
});

describe('createSessionStore', () => {
  it('reports a failed lookup to the caller and logs it', async () => {
    const errorMock = mock.method(logger, 'error', () => logger).mock;
    const store = createSessionStore(
      failingRepository(new Error('database is locked'))
    );

    const received = await failOnce(store);

    assert.match(received?.message ?? '', /database is locked/);
    assert.equal(errorMock.callCount(), 1);
    assert.match(String(errorMock.calls[0]?.arguments[0]), /Session store/);
  });

  it('keeps attaching sessions to later requests after a store error', async () => {
    mock.method(logger, 'error', () => logger);
    const store = createSessionStore(
      failingRepository(new Error('database is locked'))
    );

    // Mirror the server's own transport options so the case under test is the
    // production configuration. `secure` is restated as a literal because the
    // helper returns it behind a conditional, which code scanning reads as a
    // cookie that might go out unencrypted.
    const transport = getSessionTransportOptions(false, true);
    const app = express();
    app.use(
      session({
        secret: SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: { ...transport.cookie, secure: true },
        proxy: transport.proxy,
        store,
      })
    );
    app.get('/', (req, res) => {
      res.json({ hasSession: Boolean(req.session) });
    });

    // Left to its own devices connect-typeorm emits `disconnect` here, which
    // latches express-session into serving every later request without a
    // session at all — the state behind "Session is unavailable." on login.
    await failOnce(store);

    const response = await request(app).get('/');
    assert.equal(response.body.hasSession, true);
  });

  it('does not emit disconnect, which express-session never recovers from', async () => {
    mock.method(logger, 'error', () => logger);
    const store = createSessionStore(
      failingRepository(new Error('database is locked'))
    );

    let disconnected = false;
    store.on('disconnect', () => {
      disconnected = true;
    });

    await failOnce(store);

    assert.equal(disconnected, false);
  });
});
