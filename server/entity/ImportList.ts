import type {
  ImportListBookFormat,
  ImportListMode,
  ImportListProviderId,
} from '@server/constants/importList';
import { ImportListSyncStatus } from '@server/constants/importList';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ImportListItem } from './ImportListItem';
import { User } from './User';

/**
 * An external list a user has subscribed to. Syncing is driven by the
 * `import-list-sync` job; everything about *what* a sync did lives either on
 * the rollup columns here or on the per-item rows in {@link ImportListItem}.
 */
@Entity('import_list')
@Unique('UQ_import_list_user_provider_list', ['user', 'provider', 'listId'])
export class ImportList {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => User, (user) => user.importLists, {
    onDelete: 'CASCADE',
  })
  @Index('IDX_import_list_user')
  public user: User;

  @Column({ type: 'varchar', length: 32 })
  public provider: ImportListProviderId;

  /**
   * The canonical identifier for this list, normalized from whatever the user
   * pasted. Providers accept both full URLs and their own short forms; the
   * provider's `parse` decides what gets stored here.
   */
  @Column({ type: 'varchar', length: 512 })
  public listId: string;

  @Column({ type: 'varchar', length: 255 })
  public name: string;

  @Column({ type: 'boolean', default: true })
  public enabled: boolean;

  @Column({ type: 'varchar', length: 16 })
  public mode: ImportListMode;

  @Column({ type: 'boolean', default: false })
  public is4k: boolean;

  /** Book lists only; null for every other provider. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  public bookFormat?: ImportListBookFormat | null;

  @DbAwareColumn({ type: resolveDbType('datetime'), nullable: true })
  public lastSyncedAt?: Date | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: ImportListSyncStatus.NEVER,
  })
  public lastSyncStatus: ImportListSyncStatus;

  @Column({ type: 'varchar', length: 512, nullable: true })
  public lastSyncError?: string | null;

  /** Items the last sync read from the source list. */
  @Column({ type: 'integer', default: 0 })
  public itemCount: number;

  @Column({ type: 'integer', default: 0 })
  public lastRequestedCount: number;

  @Column({ type: 'integer', default: 0 })
  public lastSkippedCount: number;

  @Column({ type: 'integer', default: 0 })
  public lastErrorCount: number;

  @OneToMany(() => ImportListItem, (item) => item.importList, {
    cascade: true,
  })
  public items: ImportListItem[];

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<ImportList>) {
    Object.assign(this, init);
  }
}

export default ImportList;
