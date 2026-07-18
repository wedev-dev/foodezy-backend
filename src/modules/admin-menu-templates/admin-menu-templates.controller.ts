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
  Put,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AdminAuthGuard, RequestWithAdmin } from '../admin-auth/guards/admin-auth.guard';
import { PermissionGuard, RequirePermission } from '../admin-auth/guards/permission.guard';
import {
  ActorMeta,
  AdminMenuTemplatesService,
  MenuMeta,
  MenuTemplateDetail,
  MenuTemplateListRow,
  UploadedImage,
} from './admin-menu-templates.service';
import { ListMenuQueryDto } from './dto/list-menu-query.dto';
import { SaveMenuTemplateDto } from './dto/save-menu-template.dto';

@Controller('admin/menu-templates')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('menus')
export class AdminMenuTemplatesController {
  constructor(private readonly menus: AdminMenuTemplatesService) {}

  @Get()
  async list(@Query() query: ListMenuQueryDto): Promise<{
    success: true;
    data: { rows: MenuTemplateListRow[]; total: number; page: number; pageSize: number };
  }> {
    return { success: true, data: await this.menus.list(query) };
  }

  @Get('meta')
  async meta(): Promise<{ success: true; data: MenuMeta }> {
    return { success: true, data: await this.menus.meta() };
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ success: true; data: MenuTemplateDetail }> {
    return { success: true, data: await this.menus.findOne(id) };
  }

  @Post()
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  async create(
    @Body() dto: SaveMenuTemplateDto,
    @UploadedFiles() files: UploadedImage,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') ua: string | undefined,
  ): Promise<{ success: true; data: { id: number } }> {
    return { success: true, data: await this.menus.create(dto, files ?? {}, this.actor(req, ip, ua)) };
  }

  @Put(':id')
  @HttpCode(200)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveMenuTemplateDto,
    @UploadedFiles() files: UploadedImage,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') ua: string | undefined,
  ): Promise<{ success: true }> {
    await this.menus.update(id, dto, files ?? {}, this.actor(req, ip, ua));
    return { success: true };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') ua: string | undefined,
  ): Promise<{ success: true }> {
    await this.menus.remove(id, this.actor(req, ip, ua));
    return { success: true };
  }

  private actor(req: RequestWithAdmin, ip: string, ua: string | undefined): ActorMeta {
    return { adminId: req.admin!.adminId, ip: ip ?? null, userAgent: ua ?? null };
  }
}
