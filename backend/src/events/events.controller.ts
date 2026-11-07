import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { AuthGuard, CurrentUser, Roles, RolesGuard } from '../auth/guards.js';
import { DescriptionService } from './description.service.js';
import type { DraftInput } from './description.service.js';
import { EventsService } from './events.service.js';
import type { EventInput } from './events.service.js';

@Controller('events')
@UseGuards(AuthGuard, RolesGuard)
export class EventsController {
  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(DescriptionService) private readonly descriptions: DescriptionService,
  ) {}

  @Get()
  list() {
    return this.events.list();
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.events.get(id);
  }

  @Get(':id/seats')
  seats(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.events.seatMap(id, user.id);
  }

  @Post('draft-description')
  @Roles('organizer')
  draft(@Body() body: DraftInput) {
    return this.descriptions.draft(body);
  }

  @Post()
  @Roles('organizer')
  create(@CurrentUser() user: AuthUser, @Body() body: EventInput) {
    return this.events.create(user.id, body ?? ({} as EventInput));
  }

  @Patch(':id')
  @Roles('organizer')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: Partial<EventInput>) {
    return this.events.update(id, body ?? {});
  }
}
