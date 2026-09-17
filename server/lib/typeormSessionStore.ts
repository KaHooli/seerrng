import type { Session } from '@server/entity/Session';
import logger from '@server/logger';
import type { SessionData } from 'express-session';
import { Store } from 'express-session';
import { In, IsNull, MoreThan, type Repository } from 'typeorm';

const DEFAULT_TTL_SECONDS = 60 * 60 * 24;

type SessionCallback = (error?: unknown) => void;

type SessionStoreOptions = {
  cleanupLimit?: number;
  ttl?: number;
};

/**
 * Hands a failed query back to the request that caused it, and logs it.
 *
 * Deliberately does NOT emit `disconnect`. express-session latches on that
 * event: it sets `storeReady = false` and from then on serves every request
 * with no `req.session` at all, clearing the flag only on a matching
 * `connect` — which this store emits once, from its constructor. A single
 * transient database error would therefore take every login route down until
 * the process restarted, with `establishAuthenticatedSession` rejecting
 * "Session is unavailable." for password, Plex, Jellyfin and OIDC alike.
 *
 * Nothing is lost by staying quiet: the caller below already receives the
 * error, so express-session still reports it to the request that hit it, and
 * the next request simply retries against the store.
 */
const reportStoreError = (
  error: unknown,
  callback?: (...args: any[]) => void
) => {
  callback?.(error);
  logger.error('Session store query failed', {
    label: 'Server',
    errorMessage: error instanceof Error ? error.message : 'Unknown error',
  });
};

export class TypeormSessionStore extends Store {
  private readonly cleanupLimit?: number;

  private readonly ttl?: number;

  public constructor(
    private readonly repository: Repository<Session>,
    options: SessionStoreOptions = {}
  ) {
    super();
    this.cleanupLimit = options.cleanupLimit;
    this.ttl = options.ttl;
    this.emit('connect');
  }

  public get(
    sid: string,
    callback: (error: unknown, session?: SessionData | null) => void
  ): void {
    void this.repository
      .findOne({ where: { id: sid } })
      .then((session) => {
        if (!session) {
          callback(null, null);
          return;
        }

        try {
          callback(null, JSON.parse(session.json) as SessionData);
        } catch (error) {
          reportStoreError(error, callback);
        }
      })
      .catch((error: unknown) => reportStoreError(error, callback));
  }

  public set(
    sid: string,
    session: SessionData,
    callback?: SessionCallback
  ): void {
    void this.persist(sid, session)
      .then(() => callback?.())
      .catch((error: unknown) => reportStoreError(error, callback));
  }

  public destroy(sid: string | string[], callback?: SessionCallback): void {
    const ids = Array.isArray(sid) ? sid : [sid];
    void this.repository
      .softDelete({ id: In(ids) })
      .then(() => callback?.())
      .catch((error: unknown) => reportStoreError(error, callback));
  }

  public touch(
    sid: string,
    session: SessionData,
    callback?: SessionCallback
  ): void {
    void this.repository
      .update(
        { id: sid, destroyedAt: IsNull() },
        { expiredAt: this.expiresAt(session) }
      )
      .then(() => callback?.())
      .catch((error: unknown) => reportStoreError(error, callback));
  }

  public all(
    callback: (
      error: unknown,
      sessions?: SessionData[] | { [sid: string]: SessionData } | null
    ) => void
  ): void {
    void this.repository
      .find({ where: { expiredAt: MoreThan(Date.now()) } })
      .then((sessions) => {
        callback(
          null,
          sessions.map((session) => {
            const data = JSON.parse(session.json) as SessionData;
            return { ...data, id: session.id };
          })
        );
      })
      .catch((error: unknown) => reportStoreError(error, callback));
  }

  public length(callback: (error: unknown, length?: number) => void): void {
    void this.repository
      .count({ where: { expiredAt: MoreThan(Date.now()) } })
      .then((length) => callback(null, length))
      .catch((error: unknown) => reportStoreError(error, callback));
  }

  public clear(callback?: SessionCallback): void {
    void this.repository
      .clear()
      .then(() => callback?.())
      .catch((error: unknown) => reportStoreError(error, callback));
  }

  private async persist(sid: string, session: SessionData): Promise<void> {
    const json = JSON.stringify(session);
    if (json === undefined) {
      throw new Error('Session data could not be serialized');
    }
    await this.removeExpiredSessions();
    await this.repository.upsert(
      {
        id: sid,
        expiredAt: this.expiresAt(session),
        json,
        destroyedAt: null,
      },
      { conflictPaths: ['id'] }
    );
  }

  private async removeExpiredSessions(): Promise<void> {
    if (!this.cleanupLimit || this.cleanupLimit < 1) return;

    const sessions = await this.repository
      .createQueryBuilder('session')
      .withDeleted()
      .select('session.id', 'id')
      .where('session.expiredAt <= :now', { now: Date.now() })
      .limit(this.cleanupLimit)
      .getRawMany<{ id: string }>();

    if (sessions.length > 0) {
      await this.repository.delete({
        id: In(sessions.map((session) => session.id)),
      });
    }
  }

  private expiresAt(session: SessionData): number {
    const maxAge = session.cookie?.maxAge;
    const ttl =
      this.ttl ??
      (typeof maxAge === 'number'
        ? Math.floor(maxAge / 1000)
        : DEFAULT_TTL_SECONDS);
    return Date.now() + ttl * 1000;
  }
}
