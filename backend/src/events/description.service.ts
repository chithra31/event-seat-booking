import { BadRequestException, Injectable, Logger } from '@nestjs/common';

export interface DraftInput {
  name: string;
  venue?: string;
  date?: string;
  notes?: string;
}

/**
 * Drafts an event description. Uses the Anthropic API when ANTHROPIC_API_KEY
 * is set; otherwise (or on any API failure) falls back to a template so the
 * feature never blocks event creation.
 */
@Injectable()
export class DescriptionService {
  private readonly log = new Logger('Description');

  async draft(input: DraftInput): Promise<{ description: string; source: 'ai' | 'template' }> {
    if (typeof input?.name !== 'string' || !input.name.trim()) {
      throw new BadRequestException('Event name is required to draft a description');
    }
    const key = process.env.ANTHROPIC_API_KEY;
    if (key) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-5-5',
            max_tokens: 300,
            messages: [{ role: 'user', content: this.prompt(input) }],
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: any = await res.json();
        const text = data?.content?.find((c: any) => c.type === 'text')?.text?.trim();
        if (text) return { description: text, source: 'ai' };
      } catch (e: any) {
        this.log.warn(`AI draft failed, using template: ${e.message}`);
      }
    }
    return { description: this.template(input), source: 'template' };
  }

  private prompt(i: DraftInput): string {
    return (
      'Write a friendly, engaging 2-3 sentence description (max 60 words, plain text, no markdown) ' +
      'for a ticketed event.\n' +
      `Name: ${i.name}\nVenue: ${i.venue ?? 'TBA'}\nDate: ${i.date ?? 'TBA'}\n` +
      (i.notes ? `Notes from organizer: ${i.notes}\n` : '')
    );
  }

  private template(i: DraftInput): string {
    const where = i.venue?.trim() ? ` at ${i.venue.trim()}` : '';
    const when = i.date && !Number.isNaN(new Date(i.date).getTime())
      ? ` on ${new Date(i.date).toDateString()}`
      : '';
    return `Join us for ${i.name.trim()}${where}${when}. Reserve your seats early - spaces are limited and held for a short time while you confirm.`;
  }
}
