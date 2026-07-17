import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard, RequestWithAdmin } from '../admin-auth/guards/admin-auth.guard';
import { PermissionGuard, RequirePermission } from '../admin-auth/guards/permission.guard';
import {
  ActorMeta,
  AdminWebhookService,
  WebhookConfig,
  WebhookTestResult,
} from './admin-webhook.service';
import { SaveWebhookDto } from './dto/save-webhook.dto';
import { TestWebhookDto } from './dto/test-webhook.dto';

@Controller('admin/webhook')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('system')
export class AdminWebhookController {
  constructor(private readonly webhook: AdminWebhookService) {}

  @Get()
  async get(): Promise<{ success: true; data: WebhookConfig }> {
    return { success: true, data: await this.webhook.get() };
  }

  @Put()
  @HttpCode(200)
  async save(
    @Body() dto: SaveWebhookDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.webhook.save(dto, this.actor(req, ip, userAgent));
    return { success: true };
  }

  @Post('test')
  @HttpCode(200)
  async test(@Body() dto: TestWebhookDto): Promise<{ success: true; data: WebhookTestResult }> {
    return { success: true, data: await this.webhook.test(dto) };
  }

  private actor(req: RequestWithAdmin, ip: string, userAgent: string | undefined): ActorMeta {
    return { adminId: req.admin!.adminId, ip: ip ?? null, userAgent: userAgent ?? null };
  }
}
