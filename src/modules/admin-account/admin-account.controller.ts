import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Ip,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard, RequestWithAdmin } from '../admin-auth/guards/admin-auth.guard';
import { AdminAccountService } from './admin-account.service';
import { ChangePasswordDto } from './dto/change-password.dto';

@Controller('admin/account')
@UseGuards(AdminAuthGuard)
export class AdminAccountController {
  constructor(private readonly account: AdminAccountService) {}

  @Post('password')
  @HttpCode(200)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.account.changePassword(req.admin!.adminId, dto.oldPassword, dto.newPassword, {
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    });
    return { success: true };
  }
}
