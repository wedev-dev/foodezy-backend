import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** '99999' = active, '00000' = disabled (matches the legacy PHP admin). */
export const ADMIN_STATUS_ACTIVE = '99999';
export const ADMIN_STATUS_DISABLED = '00000';

/** Maps the existing `admintb` table. Schema is owned by the SQL dump. */
@Entity({ name: 'admintb' })
export class Admin {
  @PrimaryGeneratedColumn({ name: 'admin_id', type: 'int' })
  adminId!: number;

  @Column({ name: 'admin_name', type: 'varchar', length: 100 })
  adminName!: string;

  @Column({ type: 'varchar', length: 50 })
  username!: string;

  /**
   * Mixed format on purpose: some rows are bcrypt ($2y$...), others are still
   * plain text because the legacy hash migration was never finished.
   * See AdminAuthService.verifyPassword().
   */
  @Column({ type: 'varchar', length: 100 })
  password!: string;

  /** e.g. 'all' | 'orders,reports' | 'none' */
  @Column({ name: 'menu_access', type: 'text', nullable: true })
  menuAccess!: string | null;

  @Column({ type: 'varchar', length: 5, default: ADMIN_STATUS_ACTIVE })
  status!: string;
}
