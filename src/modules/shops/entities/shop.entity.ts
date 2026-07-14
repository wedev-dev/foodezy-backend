import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ShopStatus = 'pending' | 'active' | 'suspended' | 'rejected';
export type KitchenOutput = 'screen' | 'printer' | 'both';
export type OrderMode = 'qr_only' | 'staff_only' | 'both';
export type BillingType = 'per_item' | 'buffet';

/**
 * Maps the existing `shops` table. `synchronize` is OFF globally, so this
 * entity never alters the schema — it only reads/writes the columns below.
 */
@Entity({ name: 'shops' })
export class Shop {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ name: 'package_id', type: 'int', unsigned: true, nullable: true })
  packageId!: number | null;

  @Column({ name: 'shop_code', type: 'varchar', length: 20 })
  shopCode!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 150 })
  email!: string;

  // NOTE: stored as plain text on purpose (kept compatible with the existing
  // admin login). Swap to a hash in ShopsService.preparePassword() later.
  @Column({ type: 'varchar', length: 255 })
  password!: string;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({ name: 'tax_id', type: 'varchar', length: 13, nullable: true })
  taxId!: string | null;

  @Column({ name: 'owner_name', type: 'varchar', length: 150, nullable: true })
  ownerName!: string | null;

  @Column({ name: 'owner_id_card', type: 'varchar', length: 13, nullable: true })
  ownerIdCard!: string | null;

  @Column({
    type: 'enum',
    enum: ['pending', 'active', 'suspended', 'rejected'],
    default: 'pending',
  })
  status!: ShopStatus;

  @Column({ name: 'trial_start_at', type: 'datetime', nullable: true })
  trialStartAt!: Date | null;

  @Column({ name: 'trial_end_at', type: 'datetime', nullable: true })
  trialEndAt!: Date | null;

  @Column({ name: 'shop_front_url', type: 'varchar', length: 500, nullable: true })
  shopFrontUrl!: string | null;

  @Column({ name: 'shop_inside_url', type: 'varchar', length: 500, nullable: true })
  shopInsideUrl!: string | null;

  @Column({
    name: 'kitchen_output',
    type: 'enum',
    enum: ['screen', 'printer', 'both'],
    default: 'screen',
  })
  kitchenOutput!: KitchenOutput;

  @Column({ name: 'printer_ip', type: 'varchar', length: 50, nullable: true })
  printerIp!: string | null;

  @Column({
    name: 'order_mode',
    type: 'enum',
    enum: ['qr_only', 'staff_only', 'both'],
    default: 'qr_only',
  })
  orderMode!: OrderMode;

  @Column({
    name: 'billing_type',
    type: 'enum',
    enum: ['per_item', 'buffet'],
    default: 'per_item',
  })
  billingType!: BillingType;

  @Column({
    name: 'buffet_price_per_head',
    type: 'decimal',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  buffetPricePerHead!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
