import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ActorType = 'admin' | 'shop' | 'system';

/** Maps the existing `audit_logs` table. */
@Entity({ name: 'audit_logs' })
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({
    name: 'actor_type',
    type: 'enum',
    enum: ['admin', 'shop', 'system'],
    default: 'admin',
  })
  actorType!: ActorType;

  @Column({ name: 'actor_id', type: 'int', unsigned: true, nullable: true })
  actorId!: number | null;

  @Column({ type: 'varchar', length: 100 })
  action!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 60, nullable: true })
  targetType!: string | null;

  @Column({ name: 'target_id', type: 'int', unsigned: true, nullable: true })
  targetId!: number | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 300, nullable: true })
  userAgent!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
