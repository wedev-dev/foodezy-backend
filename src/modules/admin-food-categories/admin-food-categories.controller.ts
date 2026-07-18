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
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard, RequestWithAdmin } from '../admin-auth/guards/admin-auth.guard';
import { PermissionGuard, RequirePermission } from '../admin-auth/guards/permission.guard';
import {
  ActorMeta,
  AdminFoodCategoriesService,
  FoodCategoryRow,
} from './admin-food-categories.service';
import { SaveFoodCategoryDto } from './dto/save-food-category.dto';
import { ToggleActiveDto } from './dto/toggle-active.dto';

@Controller('admin/food-categories')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('menus')
export class AdminFoodCategoriesController {
  constructor(private readonly categories: AdminFoodCategoriesService) {}

  @Get()
  async list(): Promise<{ success: true; data: FoodCategoryRow[] }> {
    return { success: true, data: await this.categories.list() };
  }

  @Post()
  async create(
    @Body() dto: SaveFoodCategoryDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true; data: { id: number } }> {
    return { success: true, data: await this.categories.create(dto, this.actor(req, ip, userAgent)) };
  }

  @Put(':id')
  @HttpCode(200)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveFoodCategoryDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.categories.update(id, dto, this.actor(req, ip, userAgent));
    return { success: true };
  }

  @Patch(':id/toggle')
  @HttpCode(200)
  async toggle(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ToggleActiveDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.categories.toggle(id, dto.isActive, this.actor(req, ip, userAgent));
    return { success: true };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.categories.remove(id, this.actor(req, ip, userAgent));
    return { success: true };
  }

  private actor(req: RequestWithAdmin, ip: string, userAgent: string | undefined): ActorMeta {
    return { adminId: req.admin!.adminId, ip: ip ?? null, userAgent: userAgent ?? null };
  }
}
