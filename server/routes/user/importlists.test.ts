import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';

import {
  ImportListMode,
  ImportListProviderId,
  ImportListSyncStatus,
} from '@server/constants/importList';
import { getRepository } from '@server/datasource';
import { ImportList } from '@server/entity/ImportList';
import { User } from '@server/entity/User';
import importListSync from '@server/lib/importlistsync';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import userRoutes from '@server/routes/user';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import request from 'supertest';

let app: Express;

function createApp() {
  const instance = express();
  instance.use(express.json());
  instance.use(
    session({
      secret: 'test-secret',
      cookie: { secure: 'auto' },
      resave: false,
      saveUninitialized: false,
    })
  );
  instance.use(rateLimit({ windowMs: 60_000, limit: 10_000 }), checkUser);
  instance.use('/auth', authRoutes);
  instance.use('/user', userRoutes);
  instance.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return instance;
}

before(() => {
  app = createApp();
});

setupTestDb();

const ADMIN_EMAIL = 'admin@seerr.dev';
const FRIEND_EMAIL = 'friend@seerr.dev';
const PASSWORD = 'test1234';

async function loginAs(email: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/local')
      .send({ email, password: PASSWORD });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

/** Sets a user's permission mask and returns the saved row. */
async function setPermissions(id: number, permissions: number) {
  const userRepository = getRepository(User);
  const user = await userRepository.findOneByOrFail({ id });
  user.permissions = permissions;
  return userRepository.save(user);
}

async function seedList(userId: number) {
  const user = await getRepository(User).findOneByOrFail({ id: userId });
  return getRepository(ImportList).save(
    new ImportList({
      user,
      provider: ImportListProviderId.STEVENLU,
      listId: 'stevenlu',
      name: 'Steven Lu Popular Movies',
      enabled: true,
      mode: ImportListMode.REQUEST,
      is4k: false,
      lastSyncStatus: ImportListSyncStatus.NEVER,
      itemCount: 0,
      lastRequestedCount: 0,
      lastSkippedCount: 0,
      lastErrorCount: 0,
    })
  );
}

describe('import list routes: access control', () => {
  it('rejects an anonymous caller', async () => {
    const res = await request(app).get('/user/2/importlists');
    assert.equal(res.status, 403);
  });

  it('rejects a user without MANAGE_IMPORT_LISTS on their own profile', async () => {
    await setPermissions(2, Permission.REQUEST);
    const agent = await loginAs(FRIEND_EMAIL);

    const res = await agent.get('/user/2/importlists');

    assert.equal(res.status, 403);
    assert.match(res.body.message, /permission/i);
  });

  it("rejects a permitted user reading someone else's lists", async () => {
    await setPermissions(
      2,
      Permission.MANAGE_IMPORT_LISTS + Permission.REQUEST
    );
    const agent = await loginAs(FRIEND_EMAIL);

    const res = await agent.get('/user/1/importlists');

    assert.equal(res.status, 403);
  });

  it('lets a permitted user read their own lists', async () => {
    await setPermissions(
      2,
      Permission.MANAGE_IMPORT_LISTS + Permission.REQUEST
    );
    await seedList(2);
    const agent = await loginAs(FRIEND_EMAIL);

    const res = await agent.get('/user/2/importlists');

    assert.equal(res.status, 200);
    assert.equal(res.body.results.length, 1);
    assert.equal(res.body.results[0].listId, 'stevenlu');
    assert.equal(res.body.results[0].providerLabel, 'Steven Lu');
    assert.ok(Array.isArray(res.body.providers));
  });

  it("lets an admin manage another user's lists", async () => {
    await setPermissions(
      1,
      Permission.ADMIN +
        Permission.MANAGE_USERS +
        Permission.MANAGE_IMPORT_LISTS
    );
    await seedList(2);
    const agent = await loginAs(ADMIN_EMAIL);

    const res = await agent.get('/user/2/importlists');

    assert.equal(res.status, 200);
    assert.equal(res.body.results.length, 1);
  });

  it('refuses an admin who lacks the import list permission itself', async () => {
    await setPermissions(1, Permission.MANAGE_USERS);
    const agent = await loginAs(ADMIN_EMAIL);

    const res = await agent.get('/user/2/importlists');

    assert.equal(res.status, 403);
  });
});

describe('import list routes: create', () => {
  it('normalizes the identifier a user pastes', async () => {
    await setPermissions(
      2,
      Permission.MANAGE_IMPORT_LISTS + Permission.REQUEST
    );
    const agent = await loginAs(FRIEND_EMAIL);

    const res = await agent.post('/user/2/importlists').send({
      provider: ImportListProviderId.IMDB,
      listId: 'https://www.imdb.com/chart/top/',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.listId, 'chart:top');
    assert.equal(res.body.name, 'IMDb Top 250');
    assert.equal(res.body.mode, ImportListMode.REQUEST);
  });

  it('rejects an identifier the provider cannot read', async () => {
    await setPermissions(
      2,
      Permission.MANAGE_IMPORT_LISTS + Permission.REQUEST
    );
    const agent = await loginAs(FRIEND_EMAIL);

    const res = await agent
      .post('/user/2/importlists')
      .send({ provider: ImportListProviderId.IMDB, listId: 'not-a-list' });

    assert.equal(res.status, 400);
  });

  it('rejects an unknown provider', async () => {
    await setPermissions(
      2,
      Permission.MANAGE_IMPORT_LISTS + Permission.REQUEST
    );
    const agent = await loginAs(FRIEND_EMAIL);

    const res = await agent
      .post('/user/2/importlists')
      .send({ provider: 'letterboxed', listId: 'jane' });

    assert.equal(res.status, 400);
  });

  it('refuses to add the same list twice', async () => {
    await setPermissions(
      2,
      Permission.MANAGE_IMPORT_LISTS + Permission.REQUEST
    );
    await seedList(2);
    const agent = await loginAs(FRIEND_EMAIL);

    const res = await agent
      .post('/user/2/importlists')
      .send({ provider: ImportListProviderId.STEVENLU, listId: 'stevenlu' });

    assert.equal(res.status, 409);
  });

  it('refuses a book list when no Bookshelf service is configured', async () => {
    await setPermissions(
      2,
      Permission.MANAGE_IMPORT_LISTS + Permission.REQUEST
    );
    const agent = await loginAs(FRIEND_EMAIL);

    const res = await agent.post('/user/2/importlists').send({
      provider: ImportListProviderId.OPENLIBRARY,
      listId: 'jane/OL123L',
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Bookshelf/);
  });
});

describe('import list routes: update, delete and sync', () => {
  it('updates the fields a user owns', async () => {
    await setPermissions(
      2,
      Permission.MANAGE_IMPORT_LISTS + Permission.REQUEST
    );
    const list = await seedList(2);
    const agent = await loginAs(FRIEND_EMAIL);

    const res = await agent.put(`/user/2/importlists/${list.id}`).send({
      name: 'Popular movies',
      mode: ImportListMode.WATCHLIST,
      enabled: false,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Popular movies');
    assert.equal(res.body.mode, ImportListMode.WATCHLIST);
    assert.equal(res.body.enabled, false);
  });

  it('rejects an unknown mode', async () => {
    await setPermissions(
      2,
      Permission.MANAGE_IMPORT_LISTS + Permission.REQUEST
    );
    const list = await seedList(2);
    const agent = await loginAs(FRIEND_EMAIL);

    const res = await agent
      .put(`/user/2/importlists/${list.id}`)
      .send({ mode: 'delete-everything' });

    assert.equal(res.status, 400);
  });

  it("will not touch another user's list by id", async () => {
    await setPermissions(1, Permission.ADMIN + Permission.MANAGE_IMPORT_LISTS);
    await setPermissions(
      2,
      Permission.MANAGE_IMPORT_LISTS + Permission.REQUEST
    );
    const adminList = await seedList(1);
    const agent = await loginAs(FRIEND_EMAIL);

    const res = await agent
      .put(`/user/2/importlists/${adminList.id}`)
      .send({ name: 'Hijacked' });

    assert.equal(res.status, 404);
  });

  it('deletes a list', async () => {
    await setPermissions(
      2,
      Permission.MANAGE_IMPORT_LISTS + Permission.REQUEST
    );
    const list = await seedList(2);
    const agent = await loginAs(FRIEND_EMAIL);

    const res = await agent.delete(`/user/2/importlists/${list.id}`);

    assert.equal(res.status, 204);
    assert.equal(await getRepository(ImportList).countBy({ id: list.id }), 0);
  });

  it('runs a single list on demand and returns the outcome', async () => {
    await setPermissions(
      2,
      Permission.MANAGE_IMPORT_LISTS + Permission.REQUEST
    );
    const list = await seedList(2);
    const agent = await loginAs(FRIEND_EMAIL);

    const sync = mock.method(importListSync, 'syncSingleList', async () => ({
      listId: list.id,
      status: ImportListSyncStatus.SUCCESS,
      itemCount: 3,
      requested: 2,
      skipped: 1,
      errored: 0,
    }));

    const res = await agent.post(`/user/2/importlists/${list.id}/sync`);

    assert.equal(res.status, 200);
    assert.equal(res.body.requested, 2);
    assert.equal(sync.mock.callCount(), 1);
    mock.restoreAll();
  });

  it("summarizes a user's lists for their profile", async () => {
    await setPermissions(
      2,
      Permission.MANAGE_IMPORT_LISTS + Permission.REQUEST
    );
    const list = await seedList(2);
    list.lastSyncStatus = ImportListSyncStatus.SUCCESS;
    list.lastRequestedCount = 4;
    list.itemCount = 10;
    list.lastSyncedAt = new Date();
    await getRepository(ImportList).save(list);

    const agent = await loginAs(FRIEND_EMAIL);
    const res = await agent.get('/user/2/importlists/summary');

    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.enabled, 1);
    assert.equal(res.body.errored, 0);
    assert.equal(res.body.lastRequestedCount, 4);
    assert.equal(res.body.itemCount, 10);
    assert.equal(res.body.lists.length, 1);
  });
});
