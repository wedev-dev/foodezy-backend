import {
  Body,
  Controller,
  Delete,
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
import { ActorMeta, AdminFinanceService, RevenueReport } from './admin-finance.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { RevenueQueryDto } from './dto/revenue-query.dto';

@Controller('admin/revenue')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('billing')
export class AdminRevenueController {
  constructor(private readonly finance: AdminFinanceService) {}

  @Get()
  async revenue(@Query() query: RevenueQueryDto): Promise<{ success: true; data: RevenueReport }> {
    return { success: true, data: await this.finance.revenue(query.month) };
  }

  @Post('expenses')
  async addExpense(
    @Body() dto: CreateExpenseDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true; data: { id: number } }> {
    const id = await this.finance.addExpense(dto, this.actor(req, ip, userAgent));
    return { success: true, data: { id } };
  }

  @Delete('expenses/:id')
  @HttpCode(200)
  async removeExpense(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.finance.removeExpense(id, this.actor(req, ip, userAgent));
    return { success: true };
  }

  private actor(req: RequestWithAdmin, ip: string, userAgent: string | undefined): ActorMeta {
    return { adminId: req.admin!.adminId, ip: ip ?? null, userAgent: userAgent ?? null };
  }
}
