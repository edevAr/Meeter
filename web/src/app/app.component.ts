import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { PrefsService } from './core/prefs.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AppComponent {
  private readonly prefs = inject(PrefsService);
}
