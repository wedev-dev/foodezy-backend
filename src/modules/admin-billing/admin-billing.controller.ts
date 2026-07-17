import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard, RequestWithAdmin } from '../admin-auth/guards/admin-auth.guard';
import { PermissionGuard, RequirePermission } from '../admin-auth/guards/permission.guard';
import {
  ActorMeta,
  AdminBillingService,
  BillingHistoryPage,
  BillRow,
} from './admin-billing.service';
import { HistoryQueryDto } from './dto/history-query.dto';
import { RejectBillDto } from './dto/reject-bill.dto';

const DEFAULT_REJECT_NOTE = 'สลิปโอนเงินไม่ถูกต้อง หรือยอดเงินชำระไม่ครบถ้วน';

@Controller('admin/billing')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('billing')
export class AdminBillingController {
  constructor(private readonly billing: AdminBillingService) {}

  @Get('pending')
  async listPending(): Promise<{ success: true; data: BillRow[] }> {
    return { success: true, data: await this.billing.listPending() };
  }

  @Get('history')
  async history(
    @Query() query: HistoryQueryDto,
  ): Promise<{ success: true; data: BillingHistoryPage }> {
    return { success: true, data: await this.billing.history(query.page ?? 1) };
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true; data: { shopName: string } }> {
    const data = await this.billing.approve(id, this.actor(req, ip, userAgent));
    return { success: true, data };
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectBillDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.billing.reject(id, dto.note || DEFAULT_REJECT_NOTE, this.actor(req, ip, userAgent));
    return { success: true };
  }

  private actor(req: RequestWithAdmin, ip: string, userAgent: string | undefined): ActorMeta {
    return { adminId: req.admin!.adminId, ip: ip ?? null, userAgent: userAgent ?? null };
  }
}
