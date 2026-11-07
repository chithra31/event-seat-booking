import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles, RolesGuard } from '../auth/guards.js';
import { SettingsService } from './settings.service.js';
import type { AppSettings } from './settings.service.js';

@Controller('settings')
@UseGuards(AuthGuard, RolesGuard)
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Put()
  @Roles('organizer')
  update(@Body() body: Partial<AppSettings>) {
    return this.settings.update(body ?? {});
  }
}
