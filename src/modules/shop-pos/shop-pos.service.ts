import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CreateOrderDto } from './dto/create-order.dto';
import { ItemStatus, OrderStatus } from './dto/update-status.dto';
import { PaymentMethod } from './dto/pay.dto';
import { promptpayPayload } from './promptpay.util';

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

export interface TableBill {
  tableNumber: string;
  sessionId: number | null;
  openedAt: string | null;
  total: number;
  orders: OrderDetail[];
}

export interface Checkout {
  tableNumber: string;
  sessionId: number | null;
  total: number;
  itemCount: number;
  promptpayNumber: string | null;
  promptpayReady: boolean;
  qrPayload: string | null;
}

export interface PayResult {
  billNumber: string;
  total: number;
  method: PaymentMethod;
}

export interface PosConfig {
  shopName: string;
  address: string | null;
  phone: string | null;
  kitchenOutput: 'screen' | 'printer' | 'both';
  paperSize: string;
}

export interface StaffCall {
  id: number;
  tableId: number;
  tableNumber: string;
  callType: string;
  message: string | null;
  createdAt: string;
}

export interface CustomerTable {
  shopId: number;
  tableId: number;
  tableNumber: string;
  shopName: string;
  isOpen: boolean;
  orderMode: 'qr_only' | 'staff_only' | 'both';
}

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
         LEFT JOIN shop_foodcategories c ON c.id = m.category_id
        WHERE m.shop_id = ? AND m.is_available = 1 AND (c.is_active = 1 OR c.id IS NULL)
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
  async createOrder(shopId: number, dto: CreateOrderDto, source: 'staff' | 'qr' = 'staff'): Promise<OrderDetail> {
    const orderStatus = source === 'qr' ? 'pending' : 'confirmed';
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
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [shopId, dto.tableId, sessionId, orderNumber, orderStatus, dto.note?.trim() || null, source],
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
    // จอครัว: ทุกออเดอร์ (ยกเว้นยกเลิก) ของโต๊ะที่ยังเปิดบิลอยู่ —
    // ออเดอร์ที่เสิร์ฟแล้วยังค้างบนจอจนกว่าจะชำระเงิน/เคลียร์โต๊ะ (เพื่อไม่ให้ข้อมูลหาย)
    return this.fetchOrders(shopId, { excludeCancelled: true, openSessionOnly: true });
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

  // บิลปัจจุบันของโต๊ะ (ทุกออเดอร์ใน session ที่เปิดอยู่ ยกเว้นที่ยกเลิก — รวม delivered ด้วย)
  async tableBill(shopId: number, tableId: number): Promise<TableBill> {
    const t = await this.dataSource.query<Array<{ tableNumber: string }>>(
      `SELECT table_number AS tableNumber FROM tables WHERE id = ? AND shop_id = ? LIMIT 1`,
      [tableId, shopId],
    );
    if (!t[0]) throw new NotFoundException('ไม่พบโต๊ะนี้');

    const sess = await this.dataSource.query<Array<{ id: number; openedAt: string }>>(
      `SELECT id, opened_at AS openedAt FROM table_sessions
        WHERE shop_id = ? AND table_id = ? AND status = 'active' AND closed_at IS NULL
        ORDER BY id DESC LIMIT 1`,
      [shopId, tableId],
    );
    if (!sess[0]) {
      return { tableNumber: t[0].tableNumber, sessionId: null, openedAt: null, total: 0, orders: [] };
    }

    const orders = await this.fetchOrders(shopId, { sessionId: sess[0].id, excludeCancelled: true });
    const total = orders.reduce((s, o) => s + o.total, 0);
    return {
      tableNumber: t[0].tableNumber,
      sessionId: sess[0].id,
      openedAt: sess[0].openedAt,
      total,
      orders,
    };
  }

  // เคลียร์/ปิดโต๊ะโดยไม่ชำระ (ยกเลิกออเดอร์ที่ยังค้าง + ปิด session) — คืนสถานะโต๊ะเป็นว่าง
  async closeTable(shopId: number, tableId: number): Promise<{ closed: boolean }> {
    const sess = await this.dataSource.query<Array<{ id: number }>>(
      `SELECT id FROM table_sessions
        WHERE shop_id = ? AND table_id = ? AND status = 'active' AND closed_at IS NULL
        ORDER BY id DESC LIMIT 1`,
      [shopId, tableId],
    );
    if (!sess[0]) return { closed: false };
    const sessionId = sess[0].id;
    await this.dataSource.query(
      `UPDATE orders SET status = 'cancelled'
        WHERE session_id = ? AND status IN ('pending', 'confirmed', 'cooking', 'ready')`,
      [sessionId],
    );
    await this.dataSource.query(
      `UPDATE table_sessions SET status = 'closed', closed_at = NOW() WHERE id = ?`,
      [sessionId],
    );
    return { closed: true };
  }

  // ข้อมูลสำหรับหน้าชำระเงิน (ยอดรวม + PromptPay QR payload)
  async checkout(shopId: number, tableId: number): Promise<Checkout> {
    const bill = await this.tableBill(shopId, tableId);
    const shopRow = await this.dataSource.query<Array<{ pp: string | null }>>(
      `SELECT promptpay_number AS pp FROM shops WHERE id = ? LIMIT 1`,
      [shopId],
    );
    const promptpayNumber = shopRow[0]?.pp ?? null;
    const itemCount = bill.orders.reduce(
      (s, o) => s + o.items.reduce((a, i) => a + i.quantity, 0),
      0,
    );
    const promptpayReady = Boolean(promptpayNumber && bill.sessionId && bill.total > 0);
    const qrPayload = promptpayReady ? promptpayPayload(promptpayNumber as string, bill.total) : null;
    return {
      tableNumber: bill.tableNumber,
      sessionId: bill.sessionId,
      total: bill.total,
      itemCount,
      promptpayNumber,
      promptpayReady,
      qrPayload,
    };
  }

  // รับชำระเงิน: บันทึกบิล + ปิด session (โต๊ะกลับเป็นว่าง) + ปิดออเดอร์เป็น delivered
  async pay(shopId: number, tableId: number, method: PaymentMethod): Promise<PayResult> {
    return this.dataSource.transaction(async (manager): Promise<PayResult> => {
      const sess = await manager.query<Array<{ id: number }>>(
        `SELECT id FROM table_sessions
          WHERE shop_id = ? AND table_id = ? AND status = 'active' AND closed_at IS NULL
          ORDER BY id DESC LIMIT 1`,
        [shopId, tableId],
      );
      if (!sess[0]) throw new BadRequestException('ไม่มีบิลที่ต้องชำระสำหรับโต๊ะนี้');
      const sessionId = sess[0].id;

      const totRow = await manager.query<Array<{ total: string }>>(
        `SELECT COALESCE(SUM(CASE WHEN oi.status <> 'cancelled' THEN oi.subtotal ELSE 0 END), 0) AS total
           FROM orders o
           JOIN order_items oi ON oi.order_id = o.id
          WHERE o.session_id = ? AND o.status <> 'cancelled'`,
        [sessionId],
      );
      const total = Number(totRow[0]?.total ?? 0);
      if (total <= 0) throw new BadRequestException('ยอดบิลเป็น 0 ไม่สามารถชำระได้');

      const billNumber = await this.nextBillNumber(manager, shopId);
      await manager.query(
        `INSERT INTO bills
           (shop_id, session_id, bill_number, subtotal, discount, service_charge, vat, total,
            payment_method, payment_status, paid_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, 'paid', NOW())`,
        [shopId, sessionId, billNumber, total, total, method],
      );
      await manager.query(
        `UPDATE orders SET status = 'delivered'
          WHERE session_id = ? AND status IN ('pending', 'confirmed', 'cooking', 'ready')`,
        [sessionId],
      );
      await manager.query(
        `UPDATE table_sessions SET status = 'billed', closed_at = NOW() WHERE id = ?`,
        [sessionId],
      );
      return { billNumber, total, method };
    });
  }

  // ===================== CUSTOMER (QR) =====================
  // แปลง qr_token -> โต๊ะ/ร้าน (สำหรับหน้าลูกค้า ไม่ต้องล็อกอิน)
  async resolveToken(token: string): Promise<CustomerTable> {
    const [row] = await this.dataSource.query<
      Array<{ shopId: number; tableId: number; tableNumber: string; shopName: string; isOpen: number; orderMode: string }>
    >(
      `SELECT t.shop_id AS shopId, t.id AS tableId, t.table_number AS tableNumber,
              s.name AS shopName, s.is_open AS isOpen, s.order_mode AS orderMode
         FROM tables t JOIN shops s ON s.id = t.shop_id
        WHERE t.qr_token = ? AND t.is_active = 1 AND s.deleted_at IS NULL LIMIT 1`,
      [token],
    );
    if (!row) throw new NotFoundException('ไม่พบโต๊ะนี้ หรือ QR ไม่ถูกต้อง');
    return {
      shopId: row.shopId,
      tableId: row.tableId,
      tableNumber: row.tableNumber,
      shopName: row.shopName,
      isOpen: Number(row.isOpen) === 1,
      orderMode: row.orderMode as 'qr_only' | 'staff_only' | 'both',
    };
  }

  // เรียกพนักงาน (ลูกค้ากดจากหน้า QR)
  async callStaff(shopId: number, tableId: number, callType: string, message: string | null): Promise<{ ok: true }> {
    const type = ['utensils', 'ask', 'bill', 'other'].includes(callType) ? callType : 'ask';
    await this.dataSource.transaction(async (manager) => {
      const sessionId = await this.resolveActiveSession(manager, shopId, tableId);
      await manager.query(
        `INSERT INTO call_staff_logs (shop_id, table_id, session_id, call_type, message, is_resolved)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [shopId, tableId, sessionId, type, message?.trim() || null],
      );
    });
    return { ok: true };
  }

  // รายการเรียกพนักงานที่ยังไม่จัดการ (ฝั่ง POS)
  async listCalls(shopId: number): Promise<StaffCall[]> {
    const rows = await this.dataSource.query<
      Array<{ id: number; tableId: number; tableNumber: string; callType: string; message: string | null; createdAt: string }>
    >(
      `SELECT c.id, c.table_id AS tableId, t.table_number AS tableNumber,
              c.call_type AS callType, c.message, c.created_at AS createdAt
         FROM call_staff_logs c
         LEFT JOIN tables t ON t.id = c.table_id
        WHERE c.shop_id = ? AND c.is_resolved = 0
        ORDER BY c.created_at ASC`,
      [shopId],
    );
    return rows.map((r) => ({
      id: r.id,
      tableId: r.tableId,
      tableNumber: r.tableNumber,
      callType: r.callType,
      message: r.message,
      createdAt: r.createdAt,
    }));
  }

  async resolveCall(shopId: number, callId: number): Promise<{ resolved: boolean }> {
    const res = await this.dataSource.query(
      `UPDATE call_staff_logs SET is_resolved = 1, resolved_at = NOW() WHERE id = ? AND shop_id = ?`,
      [callId, shopId],
    );
    return { resolved: Number((res as { affectedRows?: number }).affectedRows ?? 0) > 0 };
  }

  private async nextBillNumber(manager: EntityManager, shopId: number): Promise<string> {
    const rows = await manager.query<Array<{ mx: number | null }>>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(bill_number, '-', -1) AS UNSIGNED)), 0) AS mx
         FROM bills WHERE shop_id = ?`,
      [shopId],
    );
    const seq = Number(rows[0]?.mx ?? 0) + 1;
    return `BILL-${String(seq).padStart(4, '0')}`;
  }

  // ค่าตั้งค่าร้านสำหรับ POS/ครัว (kitchen_output, paper_size, ข้อมูลหัวใบครัว)
  async config(shopId: number): Promise<PosConfig> {
    const [s] = await this.dataSource.query<
      Array<{ shopName: string; address: string | null; phone: string | null; kitchenOutput: string; paperSize: string | null }>
    >(
      `SELECT name AS shopName, address, phone, kitchen_output AS kitchenOutput, paper_size AS paperSize
         FROM shops WHERE id = ? LIMIT 1`,
      [shopId],
    );
    return {
      shopName: s?.shopName ?? '',
      address: s?.address ?? null,
      phone: s?.phone ?? null,
      kitchenOutput: (s?.kitchenOutput as 'screen' | 'printer' | 'both') ?? 'screen',
      paperSize: s?.paperSize ?? '80mm',
    };
  }

  private async fetchOrders(
    shopId: number,
    filter: { statuses?: string[]; orderId?: number; sessionId?: number; excludeCancelled?: boolean; openSessionOnly?: boolean },
  ): Promise<OrderDetail[]> {
    const where: string[] = ['o.shop_id = ?'];
    const params: Array<string | number> = [shopId];
    if (filter.orderId) {
      where.push('o.id = ?');
      params.push(filter.orderId);
    }
    if (filter.sessionId) {
      where.push('o.session_id = ?');
      params.push(filter.sessionId);
    }
    if (filter.excludeCancelled) {
      where.push("o.status <> 'cancelled'");
    }
    if (filter.openSessionOnly) {
      where.push(
        `o.session_id IN (SELECT id FROM table_sessions
                           WHERE shop_id = ? AND status = 'active' AND closed_at IS NULL)`,
      );
      params.push(shopId);
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
