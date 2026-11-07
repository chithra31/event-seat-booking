import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { AuthGuard, CurrentUser, RolesGuard } from '../auth/guards.js';
import { BookingsService } from './bookings.service.js';

@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class BookingsController {
  constructor(@Inject(BookingsService) private readonly bookings: BookingsService) {}

  /** Hold seats for the configured duration. */
  @Post('events/:eventId/holds')
  hold(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() body: { seatIds: number[] },
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookings.hold(user.id, eventId, body?.seatIds);
  }

  @Post('bookings/:id/confirm')
  confirm(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.bookings.confirm(user.id, id);
  }

  @Delete('bookings/:id')
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.bookings.cancel(user, id);
  }

  @Get('bookings/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.bookings.history(user.id);
  }
}
