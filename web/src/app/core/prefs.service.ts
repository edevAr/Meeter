import { Injectable, computed, signal } from '@angular/core';

export type AppLang = 'es' | 'en';
export type AppTheme = 'dark' | 'light';

const LANG_KEY = 'meeter.lang';
const THEME_KEY = 'meeter.theme';

const COPY: Record<AppLang, Record<string, string>> = {
  es: {
    'board.kicker': 'Atelier',
    'board.title': 'Tablero',
    'board.hint': 'Arrastra la nota amarilla al corcho. Hecho la apila. Eliminar la envía al basurero.',
    'board.search': 'Buscar notas…',
    'board.clearSearch': 'Limpiar búsqueda',
    'board.today': 'Hoy',
    'board.date': 'Fecha',
    'board.goToday': 'Ir a hoy',
    'board.emptyQuery': 'No hay notas que coincidan con',
    'board.emptyDay': 'No hay notas el',
    'board.emptyDayQuery': 'No hay coincidencias en este día. Mira otras fechas en el buscador.',
    'board.searchPast': 'Otras fechas',
    'board.untitled': 'Sin título',
    'board.drag': 'Arrastra al tablero',
    'board.forDate': 'Nota para esta fecha',
    'account.open': 'Cuenta y ajustes',
    'account.language': 'Idioma',
    'account.spanish': 'Español',
    'account.english': 'English',
    'account.color': 'Color',
    'account.light': 'Claro',
    'account.dark': 'Oscuro',
    'account.logout': 'Cerrar sesión',
    'sync.offline': 'Sin conexión. Las notas se guardan aquí.',
    'sync.pending': 'Sincronizando…',
    'login.headline': 'Tu tablero del día',
    'login.lede': 'Disfruta creando tus notas diarias, notas de voz e incluso crea recordatorios en tus notas!',
    'login.kicker.login': 'Bienvenida',
    'login.kicker.register': 'Nueva cuenta',
    'login.kicker.forgot': 'Recuperar acceso',
    'login.kicker.reset': 'Nueva clave',
    'login.title.login': 'Entra a Meeter',
    'login.title.register': 'Crea tu corcho',
    'login.title.forgot': '¿Olvidaste la clave?',
    'login.title.reset': 'Escribe el código',
    'login.action.login': 'Entrar',
    'login.action.register': 'Crear cuenta',
    'login.action.forgot': 'Enviar código',
    'login.action.reset': 'Guardar clave',
    'login.field.name': 'Nombre',
    'login.field.email': 'Correo',
    'login.field.password': 'Clave',
    'login.field.confirm': 'Repite la clave',
    'login.field.code': 'Código',
    'login.field.newPassword': 'Nueva clave',
    'login.hint.password': 'Mínimo 8 caracteres',
    'login.link.register': 'Crear cuenta',
    'login.link.forgot': 'Olvidé mi clave',
    'login.link.login': 'Ya tengo cuenta',
    'login.link.back': 'Volver a entrar',
    'login.link.code': 'Ya tengo un código',
    'login.link.again': 'Pedir otro código',
    'login.busy': 'Un segundo…',
  },
  en: {
    'board.kicker': 'Atelier',
    'board.title': 'Board',
    'board.hint': 'Drag the yellow note onto the cork. Done stacks it. Delete sends it to the trash.',
    'board.search': 'Search notes…',
    'board.clearSearch': 'Clear search',
    'board.today': 'Today',
    'board.date': 'Date',
    'board.goToday': 'Go to today',
    'board.emptyQuery': 'No notes match',
    'board.emptyDay': 'No notes on',
    'board.emptyDayQuery': 'No matches on this day. See other dates in the search results.',
    'board.searchPast': 'Other dates',
    'board.untitled': 'Untitled',
    'board.drag': 'Drag onto the board',
    'board.forDate': 'Note for this date',
    'account.open': 'Account and settings',
    'account.language': 'Language',
    'account.spanish': 'Español',
    'account.english': 'English',
    'account.color': 'Color',
    'account.light': 'Light',
    'account.dark': 'Dark',
    'account.logout': 'Log out',
    'sync.offline': 'Offline. Notes are saved on this device.',
    'sync.pending': 'Syncing…',
    'login.headline': 'Your board for the day',
    'login.lede': 'Enjoy creating your daily notes, voice notes, and even reminders on your notes!',
    'login.kicker.login': 'Welcome',
    'login.kicker.register': 'New account',
    'login.kicker.forgot': 'Recover access',
    'login.kicker.reset': 'New password',
    'login.title.login': 'Enter Meeter',
    'login.title.register': 'Create your cork board',
    'login.title.forgot': 'Forgot your password?',
    'login.title.reset': 'Enter the code',
    'login.action.login': 'Log in',
    'login.action.register': 'Create account',
    'login.action.forgot': 'Send code',
    'login.action.reset': 'Save password',
    'login.field.name': 'Name',
    'login.field.email': 'Email',
    'login.field.password': 'Password',
    'login.field.confirm': 'Repeat password',
    'login.field.code': 'Code',
    'login.field.newPassword': 'New password',
    'login.hint.password': 'At least 8 characters',
    'login.link.register': 'Create account',
    'login.link.forgot': 'Forgot password',
    'login.link.login': 'I already have an account',
    'login.link.back': 'Back to login',
    'login.link.code': 'I have a code',
    'login.link.again': 'Request another code',
    'login.busy': 'One moment…',
  },
};

@Injectable({ providedIn: 'root' })
export class PrefsService {
  readonly lang = signal<AppLang>(PrefsService.readLang());
  readonly theme = signal<AppTheme>(PrefsService.readTheme());
  readonly locale = computed(() => (this.lang() === 'en' ? 'en-US' : 'es-ES'));

  constructor() {
    this.apply();
  }

  t(key: string): string {
    const table = COPY[this.lang()];
    return table[key] ?? COPY.es[key] ?? key;
  }

  setLang(lang: AppLang): void {
    this.lang.set(lang);
    this.persist();
    this.apply();
  }

  setTheme(theme: AppTheme): void {
    this.theme.set(theme);
    this.persist();
    this.apply();
  }

  private persist(): void {
    try {
      localStorage.setItem(LANG_KEY, this.lang());
      localStorage.setItem(THEME_KEY, this.theme());
    } catch {
      /* ignore */
    }
  }

  private apply(): void {
    const root = document.documentElement;
    root.lang = this.lang();
    root.dataset['theme'] = this.theme();
  }

  private static readLang(): AppLang {
    try {
      return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'es';
    } catch {
      return 'es';
    }
  }

  private static readTheme(): AppTheme {
    try {
      return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }
}
