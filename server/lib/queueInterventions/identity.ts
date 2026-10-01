import type { QueueItem } from '@server/api/servarr/base';
import type { DownloadRecoveryServiceType } from '@server/entity/DownloadRecoveryState';
import type { DVRSettings } from '@server/lib/settings';
import { createHash, scryptSync } from 'node:crypto';

export type InterventionQueueItem = QueueItem & {
  outputPath?: string;
  movieId?: number;
  seriesId?: number;
  albumId?: number;
  bookId?: number;
};
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

// The authority digest is persisted with each intervention, so the service's
// API key must not reach it through a fast hash. scrypt keeps the authority
// sensitive to a key change without exposing a cheaply guessable digest; the
// result is cached because authorities are recomputed on every queue refresh.
const AUTHORITY_COMPONENT_SALT = 'seerrng:queue-intervention-authority';
const AUTHORITY_COMPONENT_CACHE_LIMIT = 32;
const authorityComponents = new Map<string, string>();
const deriveAuthorityComponent = (apiKey: string): string => {
  const cached = authorityComponents.get(apiKey);
  if (cached !== undefined) return cached;
  const fingerprint = scryptSync(apiKey, AUTHORITY_COMPONENT_SALT, 32).toString(
    'hex'
  );
  if (authorityComponents.size >= AUTHORITY_COMPONENT_CACHE_LIMIT) {
    authorityComponents.delete(authorityComponents.keys().next().value!);
  }
  authorityComponents.set(apiKey, fingerprint);
  return fingerprint;
};
export const serviceAuthority = (
  type: DownloadRecoveryServiceType,
  server: DVRSettings
) =>
  hash([
    type,
    server.id,
    server.hostname,
    server.port,
    server.useSsl,
    server.baseUrl,
    deriveAuthorityComponent(server.apiKey),
    server.syncEnabled,
    server.is4k,
    'serviceType' in server ? server.serviceType : undefined,
  ]);
export const queueIdentity = (authority: string, item: InterventionQueueItem) =>
  hash([
    authority,
    item.id,
    item.downloadId || '',
    item.movieId,
    item.seriesId,
    item.albumId,
    item.bookId,
    item.title,
    item.size,
  ]);
export const isActionableQueueItem = (item: InterventionQueueItem): boolean =>
  /warning|error|failed|blocked/i.test(
    [item.status, item.trackedDownloadStatus, item.trackedDownloadState].join(
      ' '
    )
  ) ||
  (Array.isArray(item.statusMessages) && item.statusMessages.length > 0);
export function safeDiagnostic(value: unknown, secret: string): string {
  if (typeof value !== 'string') return '';
  return value
    .slice(0, 4000)
    .split(secret || '\0')
    .join('[redacted]')
    .replace(
      /((?:api[-_]?key|(?:access[-_]?)?token|pass(?:word|key)|secret|auth(?:orization)?)\s*[=:]\s*)[^\s&#]+/gi,
      '$1[redacted]'
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[redacted]@');
}
export const warningText = (
  item: InterventionQueueItem,
  secret: string
): string =>
  JSON.stringify(
    (Array.isArray(item.statusMessages) ? item.statusMessages : [])
      .slice(0, 20)
      .flatMap((message) => [
        message?.title,
        ...(Array.isArray(message?.messages)
          ? message.messages.slice(0, 20)
          : []),
      ])
      .map((message) => safeDiagnostic(message, secret))
      .filter(Boolean)
      .slice(0, 40)
  );
