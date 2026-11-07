import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <div class="card narrow">
      <h2>{{ mode() === 'login' ? 'Log in' : 'Create attendee account' }}</h2>
      <form (ngSubmit)="submit()">
        @if (mode() === 'register') {
          <label>Name <input name="name" [(ngModel)]="name" required /></label>
        }
        <label>Email <input name="email" type="email" [(ngModel)]="email" required /></label>
        <label>Password <input name="password" type="password" [(ngModel)]="password" required minlength="6" /></label>
        @if (error()) { <p class="error">{{ error() }}</p> }
        <button class="primary" type="submit">{{ mode() === 'login' ? 'Log in' : 'Register' }}</button>
      </form>
      <p>
        <button class="link" (click)="mode.set(mode() === 'login' ? 'register' : 'login')">
          {{ mode() === 'login' ? 'No account? Register' : 'Have an account? Log in' }}
        </button>
      </p>
      <p class="hint">Demo: organizer&#64;example.com or attendee1&#64;example.com / password123</p>
    </div>
  `,
})
export class LoginPage {
  private api = inject(ApiService);
  private router = inject(Router);
  mode = signal<'login' | 'register'>('login');
  error = signal('');
  name = '';
  email = '';
  password = '';

  submit() {
    const req =
      this.mode() === 'login'
        ? this.api.login(this.email, this.password)
        : this.api.register(this.email, this.name, this.password);
    req.subscribe({
      next: () => this.router.navigate(['/events']),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }
}
