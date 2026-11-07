import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from './core/api.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="nav">
      <a class="brand" routerLink="/events">🎟 SeatBooking</a>
      @if (api.user(); as u) {
        <nav>
          <a routerLink="/events" routerLinkActive="active">Events</a>
          <a routerLink="/bookings" routerLinkActive="active">My bookings</a>
          @if (api.isOrganizer()) {
            <a routerLink="/admin/new-event" routerLinkActive="active">New event</a>
            <a routerLink="/admin/settings" routerLinkActive="active">Settings</a>
          }
        </nav>
        <span class="who">{{ u.name }} <small>({{ u.role }})</small></span>
        <button class="link" (click)="api.logout()">Log out</button>
      }
    </header>
    <main><router-outlet /></main>
  `,
})
export class App {
  protected api = inject(ApiService);
}
