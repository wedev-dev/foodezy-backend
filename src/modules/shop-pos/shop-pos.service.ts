import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CreateOrderDto } from './dto/create-order.dto';
import { ItemStatus, OrderStatus } from './dto/update-status.dto';

// ---- catalog (เมนูสำหรับหน้าจดออเดอร์) ----
export interface PosOptionItem {
  id: number;
  name: string;
  priceAdjustment: number;
}
export interface PosOptionGroup {
  id: number;
  name: string;
  selectionType: 'single' | 'multiple';
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  items: PosOptionItem[];
}
export interface PosCategory {
  id: number;
  name: string;
}
export interface PosMenu {
  id: number;
  categoryId: number;
  name: string;
  price: number;
  imageUrl: string | null;
  isRecommended: boolean;
  menuPricingType: string;
  optionGroups: PosOptionGroup[];
}

// ---- tables (สถานะโต๊ะบนหน้า POS) ----
export interface PosTable {
  id: number;
  tableNumber: string;
  seats: number;
  sessionId: number | null;
  openedAt: string | null;
  orderCount: number;
  total: number;
}

// ---- orders (กล่องออเดอร์เข้า / จอครัว) ----
export interface OrderItemOption {
  id: number;
  optionName: string;
  extraPrice: number;
}
export interface OrderItem {
  id: number;
  menuId: number;
  menuName: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  note: string | null;
  status: ItemStatus;
  options: OrderItemOption[];
}
export interface OrderDetail {
  id: number;
  orderNumber: string;
  tableId: number;
  tableNumber: string;
  sessionId: number;
  status: OrderStatus;
  source: 'qr' | 'staff';
  note: string | null;
  total: number;
  createdAt: string;
  items: OrderItem[];
}

const ACTIVE_ORDER_STATUSES = ['pending', 'confirmed', 'cooking', 'ready'] as const;

@Injectable()
export class ShopPosService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // ===================== CATALOG =====================
  async catalog(shopId: number): Promise<{ categories: PosCategory[]; menus: PosMenu[] }> {
    const categories = await this.dataSource.query<PosCategory[]>(
      `SELECT id, name FROM shop_foodcategories
        WHERE shop_id = ? AND is_active = 1
        ORDER BY sort_order ASC, name ASC`,
      [shopId],
    );

    const rawMenus = await this.dataSource.query<
      Array<{
        id: number;
        categoryId: number;
        name: string;
        price: string;
        imageUrl: string | null;
        isRecommended: number;
        menuPricingType: string;
      }>
    >(
      `SELECT m.id, m.category_id AS categoryId, m.name, m.price, m.image_url AS imageUrl,
              m.is_recommended AS isRecommended, m.menu_pricing_type AS menuPricingType
         FROM shop_menus m
         JOIN shop_foodcategories c ON c.id = m.category_id
        WHERE m.shop_id = ? AND m.is_available = 1 AND c.is_active = 1
        ORDER BY c.sort_order ASC, m.sort_order ASC, m.id ASC`,
      [shopId],
    );
    if (!rawMenus.length) return { categories, menus: [] };

    const menuIds = rawMenus.map((m) => m.id);
    const links = await this.dataSource.query<
      Array<{ menuId: number; groupId: number; sortOrder: number }>
    >(
      `SELECT mog.menu_id AS menuId, mog.shop_option_group_id AS groupId, mog.sort_order AS sortOrder
         FROM menu_option_groups mog
        WHERE mog.menu_id IN (${menuIds.map(() => '?').join(',')})
        ORDER BY mog.sort_order ASC, mog.id ASC`,
      menuIds,
    );

    const groupIds = [...new Set(links.map((l) => l.groupId))];
    const groups = groupIds.length
      ? await this.dataSource.query<
          Array<{
            id: number;
            name: string;
            selectionType: 'single' | 'multiple';
            isRequired: number;
            minSelect: number;
            maxSelect: number;
          }>
        >(
          `SELECT id, name, selection_type AS selectionType, is_required AS isRequired,
                  min_select AS minSelect, max_select AS maxSelect
             FROM shop_option_groups
            WHERE shop_id = ? AND id IN (${groupIds.map(() => '?').join(',')})`,
          [shopId, ...groupIds],
        )
      : [];

    const items = groupIds.length
      ? await this.dataSource.query<
          Array<{ id: number; groupId: number; name: string; priceAdjustment: string }>
        >(
          `SELECT id, shop_option_group_id AS groupId, name, price_adjustment AS priceAdjustment
             FROM shop_option_items
            WHERE is_available = 1 AND shop_option_group_id IN (${groupIds.map(() => '?').join(',')})
            ORDER BY sort_order ASC, id ASC`,
          groupIds,
        )
      : [];

    const groupById = new Map<number, PosOptionGroup>(
      groups.map((g) => [
        g.id,
        {
          id: g.id,
          name: g.name,
          selectionType: g.selectionType,
          isRequired: Number(g.isRequired) === 1,
          minSelect: Number(g.minSelect ?? 0),
          maxSelect: Number(g.maxSelect ?? 0),
          items: items
            .filter((it) => it.groupId === g.id)
            .map((it) => ({
              id: it.id,
              name: it.name,
              priceAdjustment: Number(it.priceAdjustment),
            })),
        },
      ]),
    );

    const menus: PosMenu[] = rawMenus.map((m) => ({
      id: m.id,
      categoryId: m.categoryId,
      name: m.name,
      price: Number(m.price),
      imageUrl: m.imageUrl,
      isRecommended: Number(m.isRecommended) === 1,
      menuPricingType: m.menuPricingType,
      optionGroups: links
        .filter((l) => l.menuId === m.id)
        .map((l) => groupById.get(l.groupId))
        .filter((g): g is PosOptionGroup => Boolean(g)),
    }));

    return { categories, menus };
  }

  // ===================== TABLES =====================
  async tables(shopId: number): Promise<PosTable[]> {
    const rows = await this.dataSource.query<
      Array<{
        id: number;
        tableNumber: string;
        seats: number;
        sessionId: number | null;
        openedAt: string | null;
      }>
    >(
      `SELECT t.id, t.table_number AS tableNumber, t.seats,
              (SELECT ts.id FROM table_sessions ts
                 WHERE ts.table_id = t.id AND ts.shop_id = t.shop_id
                   AND ts.status = 'active' AND ts.closed_at IS NULL
                 ORDER BY ts.id DESC LIMIT 1) AS sessionId,
              (SELECT ts.opened_at FROM table_sessions ts
                 WHERE ts.table_id = t.id AND ts.shop_id = t.shop_id
                   AND ts.status = 'active' AND ts.closed_at IS NULL
                 ORDER BY ts.id DESC LIMIT 1) AS openedAt
         FROM tables t
        WHERE t.shop_id = ? AND t.is_active = 1
        ORDER BY (t.table_number REGEXP '^[0-9]+$') DESC,
                 CAST(t.table_number AS UNSIGNED) ASC, t.table_number ASC`,
      [shopId],
    );

    const sessionIds = rows
      .map((r) => r.sessionId)
      .filter((id): id is number => id !== null);

    const totals = sessionIds.length
      ? await this.dataSource.query<
          Array<{ sessionId: number; orderCount: number; total: string }>
        >(
          `SELECT o.session_id AS sessionId,
                  COUNT(DISTINCT o.id) AS orderCount,
                  COALESCE(SUM(CASE WHEN oi.status <> 'cancelled' THEN oi.subtotal ELSE 0 END), 0) AS total
             FROM orders o
             LEFT JOIN order_items oi ON oi.order_id = o.id
            WHERE o.shop_id = ? AND o.status <> 'cancelled'
              AND o.session_id IN (${sessionIds.map(() => '?').join(',')})
            GROUP BY o.session_id`,
          [shopId, ...sessionIds],
        )
      : [];
    const totalBySession = new Map(
      totals.map((t) => [t.sessionId, { orderCount: Number(t.orderCount), total: Number(t.total) }]),
    );

    return rows.map((r) => {
      const agg = r.sessionId ? totalBySession.get(r.sessionId) : undefined;
      return {
        id: r.id,
        tableNumber: r.tableNumber,
        seats: Number(r.seats),
        sessionId: r.sessionId,
        openedAt: r.openedAt,
        orderCount: agg?.orderCount ?? 0,
        total: agg?.total ?? 0,
      };
    });
  }

  // ===================== CREATE ORDER (staff) =====================
  async createOrder(shopId: number, dto: CreateOrderDto): Promise<OrderDetail> {
    const orderId = await this.dataSource.transaction(async (manager): Promise<number> => {
      const tableRows = await manager.query<Array<{ id: number }>>(
        `SELECT id FROM tables WHERE id = ? AND shop_id = ? AND is_active = 1 LIMIT 1`,
        [dto.tableId, shopId],
      );
      if (!tableRows[0]) {
        throw new NotFoundException('ไม่พบโต๊ะนี้ หรือโต๊ะถูกปิดใช้งาน');
      }

      const sessionId = await this.resolveActiveSession(manager, shopId, dto.tableId);
      const orderNumber = await this.nextOrderNumber(manager, shopId);

      const insertOrder = await manager.query(
        `INSERT INTO orders (shop_id, table_id, session_id, order_number, status, note, source)
         VALUES (?, ?, ?, ?, 'confirmed', ?, 'staff')`,
        [shopId, dto.tableId, sessionId, orderNumber, dto.note?.trim() || null],
      );
      const newOrderId = Number((insertOrder as { insertId: number }).insertId);

      for (const item of dto.items) {
        const menuRows = await manager.query<Array<{ id: number; name: string; price: string }>>(
          `SELECT id, name, price FROM shop_menus
            WHERE id = ? AND shop_id = ? AND is_available = 1 LIMIT 1`,
          [item.menuId, shopId],
        );
        const menu = menuRows[0];
        if (!menu) {
          throw new BadRequestException('มีเมนูที่ไม่พร้อมขายอยู่ในรายการ กรุณาตรวจสอบอีกครั้ง');
        }

        const optionIds = [...new Set(item.optionItemIds ?? [])].filter((n) => Number.isInteger(n) && n > 0);
        const selectedOptions = optionIds.length
          ? await manager.query<Array<{ id: number; name: string; extraPrice: string }>>(
              `SELECT oi.id, oi.name, oi.price_adjustment AS extraPrice
                 FROM shop_option_items oi
                 JOIN shop_option_groups g ON g.id = oi.shop_option_group_id
                 JOIN menu_option_groups mog ON mog.shop_option_group_id = g.id
                WHERE mog.menu_id = ? AND g.shop_id = ? AND oi.is_available = 1
                  AND oi.id IN (${optionIds.map(() => '?').join(',')})`,
              [item.menuId, shopId, ...optionIds],
            )
          : [];
        if (selectedOptions.length !== optionIds.length) {
          throw new BadRequestException('มีตัวเลือกเสริมที่ไม่ถูกต้องสำหรับเมนูนี้');
        }

        const extra = selectedOptions.reduce((sum, o) => sum + Number(o.extraPrice), 0);
        const unitPrice = Number(menu.price) + extra;
        const subtotal = unitPrice * item.quantity;

        const insertItem = await manager.query(
          `INSERT INTO order_items
             (order_id, menu_id, menu_name, unit_price, quantity, subtotal, note, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [
            newOrderId,
            menu.id,
            menu.name,
            unitPrice,
            item.quantity,
            subtotal,
            item.note?.trim() || null,
          ],
        );
        const orderItemId = Number((insertItem as { insertId: number }).insertId);

        for (const opt of selectedOptions) {
          await manager.query(
            `INSERT INTO order_item_options (order_item_id, option_id, option_name, extra_price)
             VALUES (?, ?, ?, ?)`,
            [orderItemId, opt.id, opt.name, Number(opt.extraPrice)],
          );
        }
      }

      return newOrderId;
    });

    const detail = await this.orderDetail(shopId, orderId);
    if (!detail) throw new NotFoundException('ไม่พบออเดอร์ที่เพิ่งสร้าง');
    return detail;
  }

  // ===================== ORDER BOARD =====================
  async activeOrders(shopId: number): Promise<OrderDetail[]> {
    const orders = await this.fetchOrders(shopId, {
      statuses: [...ACTIVE_ORDER_STATUSES],
    });
    return orders;
  }

  async orderDetail(shopId: number, orderId: number): Promise<OrderDetail | null> {
    const orders = await this.fetchOrders(shopId, { orderId });
    return orders[0] ?? null;
  }

  async updateOrderStatus(shopId: number, orderId: number, status: OrderStatus): Promise<void> {
    const rows = await this.dataSource.query<Array<{ id: number }>>(
      `SELECT id FROM orders WHERE id = ? AND shop_id = ? LIMIT 1`,
      [orderId, shopId],
    );
    if (!rows[0]) throw new NotFoundException('ไม่พบออเดอร์นี้');
    await this.dataSource.query(`UPDATE orders SET status = ? WHERE id = ? AND shop_id = ?`, [
      status,
      orderId,
      shopId,
    ]);
  }

  async updateItemStatus(shopId: number, itemId: number, status: ItemStatus): Promise<void> {
    const rows = await this.dataSource.query<Array<{ id: number }>>(
      `SELECT oi.id
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE oi.id = ? AND o.shop_id = ? LIMIT 1`,
      [itemId, shopId],
    );
    if (!rows[0]) throw new NotFoundException('ไม่พบรายการนี้');
    await this.dataSource.query(`UPDATE order_items SET status = ? WHERE id = ?`, [status, itemId]);
  }

  // ===================== helpers =====================
  private async resolveActiveSession(
    manager: EntityManager,
    shopId: number,
    tableId: number,
  ): Promise<number> {
    const existing = await manager.query<Array<{ id: number }>>(
      `SELECT id FROM table_sessions
        WHERE shop_id = ? AND table_id = ? AND status = 'active' AND closed_at IS NULL
        ORDER BY id DESC LIMIT 1`,
      [shopId, tableId],
    );
    if (existing[0]) return existing[0].id;

    const token = `sess_${randomBytes(16).toString('hex')}`;
    const res = await manager.query(
      `INSERT INTO table_sessions (shop_id, table_id, session_token, status, guest_count)
       VALUES (?, ?, ?, 'active', 1)`,
      [shopId, tableId, token],
    );
    return Number((res as { insertId: number }).insertId);
  }

  private async nextOrderNumber(manager: EntityManager, shopId: number): Promise<string> {
    const rows = await manager.query<Array<{ mx: number | null }>>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(order_number, '-', -1) AS UNSIGNED)), 0) AS mx
         FROM orders WHERE shop_id = ?`,
      [shopId],
    );
    const seq = Number(rows[0]?.mx ?? 0) + 1;
    return `ORD-${String(seq).padStart(4, '0')}`;
  }

  private async fetchOrders(
    shopId: number,
    filter: { statuses?: string[]; orderId?: number },
  ): Promise<OrderDetail[]> {
    const where: string[] = ['o.shop_id = ?'];
    const params: Array<string | number> = [shopId];
    if (filter.orderId) {
      where.push('o.id = ?');
      params.push(filter.orderId);
    }
    if (filter.statuses && filter.statuses.length) {
      where.push(`o.status IN (${filter.statuses.map(() => '?').join(',')})`);
      params.push(...filter.statuses);
    }

    const orderRows = await this.dataSource.query<
      Array<{
        id: number;
        orderNumber: string;
        tableId: number;
        tableNumber: string;
        sessionId: number;
        status: OrderStatus;
        source: 'qr' | 'staff';
        note: string | null;
        createdAt: string;
      }>
    >(
      `SELECT o.id, o.order_number AS orderNumber, o.table_id AS tableId,
              t.table_number AS tableNumber, o.session_id AS sessionId,
              o.status, o.source, o.note, o.created_at AS createdAt
         FROM orders o
         LEFT JOIN tables t ON t.id = o.table_id
        WHERE ${where.join(' AND ')}
        ORDER BY o.created_at ASC, o.id ASC`,
      params,
    );
    if (!orderRows.length) return [];

    const orderIds = orderRows.map((o) => o.id);
    const itemRows = await this.dataSource.query<
      Array<{
        id: number;
        orderId: number;
        menuId: number;
        menuName: string;
        unitPrice: string;
        quantity: number;
        subtotal: string;
        note: string | null;
        status: ItemStatus;
      }>
    >(
      `SELECT id, order_id AS orderId, menu_id AS menuId, menu_name AS menuName,
              unit_price AS unitPrice, quantity, subtotal, note, status
         FROM order_items
        WHERE order_id IN (${orderIds.map(() => '?').join(',')})
        ORDER BY id ASC`,
      orderIds,
    );

    const itemIds = itemRows.map((it) => it.id);
    const optionRows = itemIds.length
      ? await this.dataSource.query<
          Array<{ id: number; orderItemId: number; optionName: string; extraPrice: string }>
        >(
          `SELECT id, order_item_id AS orderItemId, option_name AS optionName, extra_price AS extraPrice
             FROM order_item_options
            WHERE order_item_id IN (${itemIds.map(() => '?').join(',')})
            ORDER BY id ASC`,
          itemIds,
        )
      : [];

    return orderRows.map((o) => {
      const items: OrderItem[] = itemRows
        .filter((it) => it.orderId === o.id)
        .map((it) => ({
          id: it.id,
          menuId: it.menuId,
          menuName: it.menuName,
          unitPrice: Number(it.unitPrice),
          quantity: Number(it.quantity),
          subtotal: Number(it.subtotal),
          note: it.note,
          status: it.status,
          options: optionRows
            .filter((op) => op.orderItemId === it.id)
            .map((op) => ({
              id: op.id,
              optionName: op.optionName,
              extraPrice: Number(op.extraPrice),
            })),
        }));
      const total = items
        .filter((it) => it.status !== 'cancelled')
        .reduce((sum, it) => sum + it.subtotal, 0);
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        tableId: o.tableId,
        tableNumber: o.tableNumber,
        sessionId: o.sessionId,
        status: o.status,
        source: o.source,
        note: o.note,
        total,
        createdAt: o.createdAt,
        items,
      };
    });
  }
}
