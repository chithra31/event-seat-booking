import { Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { AuthGuard, RolesGuard } from './auth/guards.js';
import { BookingsController } from './bookings/bookings.controller.js';
import { BookingsService } from './bookings/bookings.service.js';
import { Clock, SystemClock } from './common/clock.js';
import { DbModule } from './db/db.module.js';
import { DescriptionService } from './events/description.service.js';
import { EventsController } from './events/events.controller.js';
import { EventsService } from './events/events.service.js';
import { SettingsController } from './settings/settings.controller.js';
import { SettingsService } from './settings/settings.service.js';

@Module({
  imports: [DbModule],
  controllers: [AuthController, EventsController, BookingsController, SettingsController],
  providers: [
    { provide: Clock, useClass: SystemClock },
    AuthService,
    AuthGuard,
    RolesGuard,
    SettingsService,
    EventsService,
    DescriptionService,
    BookingsService,
  ],
  exports: [AuthService, EventsService, BookingsService, SettingsService],
})
export class AppModule {}
