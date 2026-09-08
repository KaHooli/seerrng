import type { ImportListItemStatus } from '@server/constants/importList';
import type { MediaType } from '@server/constants/media';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ImportList } from './ImportList';

/**
 * One row per item a sync has processed. Keeping the resolved id means a
 * re-sync never re-resolves an item it has already seen, which is what makes
 * repeat syncs of a 250-title list cheap.
 *
 * `tmdbId` and `externalId` are alternatives, not both: movies and series
 * resolve to a TMDB id, books to an Open Library id, and an unresolved item has
 * neither and a status of `not_found`.
 */
@Entity('import_list_item')
@Unique('UQ_import_list_item_tmdb', ['importList', 'mediaType', 'tmdbId'])
@Unique('UQ_import_list_item_external', [
  'importList',
  'mediaType',
  'externalId',
])
export class ImportListItem {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => ImportList, (list) => list.items, {
    onDelete: 'CASCADE',
  })
  @Index('IDX_import_list_item_list')
  public importList: ImportList;

  @Column({ type: 'varchar', length: 16 })
  public mediaType: MediaType;

  @Column({ type: 'integer', nullable: true })
  public tmdbId?: number | null;

  /** Open Library work id for books; IMDb id when nothing better resolved. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  public externalId?: string | null;

  @Column({ type: 'varchar', length: 255 })
  public title: string;

  @Column({ type: 'integer', nullable: true })
  public year?: number | null;

  @Column({ type: 'varchar', length: 32 })
  @Index('IDX_import_list_item_status')
  public status: ImportListItemStatus;

  @Column({ type: 'varchar', length: 512, nullable: true })
  public message?: string | null;

  @DbAwareColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public processedAt: Date;

  constructor(init?: Partial<ImportListItem>) {
    Object.assign(this, init);
  }
}

export default ImportListItem;
