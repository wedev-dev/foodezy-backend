import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StaffDto } from './dto/staff.dto';

export interface PermissionRow { id: number; slug: string; description: string; groupName: string }
export interface StaffRow {
  id: number; name: string; phone: string | null; isSuperadmin: boolean; isActive: boolean;
  roleId: number | null; permissionIds: number[];
}

@Injectable()
export class ShopStaffService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async permissions(): Promise<PermissionRow[]> {
    return this.dataSource.query<PermissionRow[]>(
      `SELECT id, slug, description, group_name AS groupName FROM system_permissions ORDER BY id ASC`,
    );
  }

  async list(shopId: number): Promise<StaffRow[]> {
    const staff = await this.dataSource.query<
      Array<Omit<StaffRow, 'isSuperadmin' | 'isActive' | 'permissionIds'> & { isSuperadmin: number; isActive: number }>
    >(
      `SELECT id, name, phone, is_superadmin AS isSuperadmin, is_active AS isActive, role_id AS roleId
         FROM shop_staff WHERE shop_id = ? ORDER BY id ASC`,
      [shopId],
    );
    if (!staff.length) return [];
    const roleIds = staff.map((s) => s.roleId).filter((r): r is number => !!r);
    let perms: Array<{ roleId: number; permId: number }> = [];
    if (roleIds.length) {
      perms = await this.dataSource.query<Array<{ roleId: number; permId: number }>>(
        `SELECT role_id AS roleId, permission_id AS permId FROM role_has_permissions
          WHERE role_id IN (${roleIds.map(() => '?').join(',')})`,
        roleIds,
      );
    }
    return staff.map((s) => ({
      id: s.id, name: s.name, phone: s.phone, roleId: s.roleId,
      isSuperadmin: Number(s.isSuperadmin) === 1,
      isActive: Number(s.isActive) === 1,
      permissionIds: perms.filter((p) => p.roleId === s.roleId).map((p) => p.permId),
    }));
  }

  async create(shopId: number, dto: StaffDto): Promise<{ id: number }> {
    if (!dto.password) throw new BadRequestException('กรุณากำหนดรหัสผ่านให้พนักงาน');
    await this.assertPhoneFree(shopId, dto.phone, null);

    const roleId = await this.createRole(shopId, dto.name);
    if (!dto.isSuperadmin) await this.setRolePerms(roleId, dto.permissionIds ?? []);

    const res = await this.dataSource.query(
      `INSERT INTO shop_staff (shop_id, role_id, name, phone, username, password, is_superadmin, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [shopId, roleId, dto.name.trim(), dto.phone.trim(), dto.phone.trim(), dto.password, dto.isSuperadmin ? 1 : 0],
    );
    return { id: Number((res as { insertId: number }).insertId) };
  }

  async update(shopId: number, id: number, dto: StaffDto): Promise<void> {
    const cur = await this.getOwned(shopId, id);
    await this.assertPhoneFree(shopId, dto.phone, id);

    // role ส่วนตัว (สร้างถ้ายังไม่มี)
    let roleId = cur.role_id;
    if (!roleId) roleId = await this.createRole(shopId, dto.name);
    else await this.dataSource.query('UPDATE shop_roles SET role_name = ? WHERE id = ? AND shop_id = ?', [dto.name.trim(), roleId, shopId]);

    if (dto.isSuperadmin) await this.setRolePerms(roleId, []);
    else await this.setRolePerms(roleId, dto.permissionIds ?? []);

    if (dto.password) {
      await this.dataSource.query(
        `UPDATE shop_staff SET name = ?, phone = ?, username = ?, password = ?, is_superadmin = ?, role_id = ?
         WHERE id = ? AND shop_id = ?`,
        [dto.name.trim(), dto.phone.trim(), dto.phone.trim(), dto.password, dto.isSuperadmin ? 1 : 0, roleId, id, shopId],
      );
    } else {
      await this.dataSource.query(
        `UPDATE shop_staff SET name = ?, phone = ?, username = ?, is_superadmin = ?, role_id = ?
         WHERE id = ? AND shop_id = ?`,
        [dto.name.trim(), dto.phone.trim(), dto.phone.trim(), dto.isSuperadmin ? 1 : 0, roleId, id, shopId],
      );
    }
  }

  async toggleActive(shopId: number, id: number): Promise<{ isActive: boolean }> {
    await this.getOwned(shopId, id);
    await this.dataSource.query('UPDATE shop_staff SET is_active = 1 - is_active WHERE id = ? AND shop_id = ?', [id, shopId]);
    const row = await this.dataSource.query<Array<{ is_active: number }>>(
      'SELECT is_active FROM shop_staff WHERE id = ? AND shop_id = ? LIMIT 1', [id, shopId],
    );
    return { isActive: Number(row[0].is_active) === 1 };
  }

  async remove(shopId: number, id: number): Promise<void> {
    const cur = await this.getOwned(shopId, id);
    await this.dataSource.query('DELETE FROM shop_staff WHERE id = ? AND shop_id = ?', [id, shopId]);
    if (cur.role_id) {
      await this.dataSource.query('DELETE FROM role_has_permissions WHERE role_id = ?', [cur.role_id]);
      await this.dataSource.query('DELETE FROM shop_roles WHERE id = ? AND shop_id = ?', [cur.role_id, shopId]);
    }
  }

  // ---- helpers ----
  private async createRole(shopId: number, name: string): Promise<number> {
    const res = await this.dataSource.query(
      'INSERT INTO shop_roles (shop_id, role_name) VALUES (?, ?)',
      [shopId, `พนักงาน: ${name.trim()}`],
    );
    return Number((res as { insertId: number }).insertId);
  }

  private async setRolePerms(roleId: number, permissionIds: number[]): Promise<void> {
    await this.dataSource.query('DELETE FROM role_has_permissions WHERE role_id = ?', [roleId]);
    const ids = [...new Set(permissionIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) return;
    const valid = await this.dataSource.query<Array<{ id: number }>>(
      `SELECT id FROM system_permissions WHERE id IN (${ids.map(() => '?').join(',')})`, ids,
    );
    for (const p of valid) {
      await this.dataSource.query('INSERT INTO role_has_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, p.id]);
    }
  }

  private async getOwned(shopId: number, id: number): Promise<{ role_id: number | null }> {
    const rows = await this.dataSource.query<Array<{ role_id: number | null }>>(
      'SELECT role_id FROM shop_staff WHERE id = ? AND shop_id = ? LIMIT 1', [id, shopId],
    );
    if (!rows[0]) throw new NotFoundException('ไม่พบพนักงานคนนี้');
    return rows[0];
  }

  private async assertPhoneFree(shopId: number, phone: string, selfId: number | null): Promise<void> {
    const owner = await this.dataSource.query<Array<{ id: number }>>(
      'SELECT id FROM shops WHERE phone = ? AND deleted_at IS NULL LIMIT 1', [phone.trim()],
    );
    if (owner[0]) throw new BadRequestException('เบอร์นี้ซ้ำกับเจ้าของร้าน');
    const staff = await this.dataSource.query<Array<{ id: number }>>(
      'SELECT id FROM shop_staff WHERE phone = ? AND (? IS NULL OR id <> ?) LIMIT 1',
      [phone.trim(), selfId, selfId],
    );
    if (staff[0]) throw new BadRequestException('เบอร์นี้มีพนักงานใช้อยู่แล้ว');
  }
}
