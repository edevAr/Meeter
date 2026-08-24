import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _langKey = 'meeter.lang';
const _themeKey = 'meeter.theme';

class PrefsController extends ChangeNotifier {
  PrefsController();

  String lang = 'es';
  ThemeMode themeMode = ThemeMode.dark;
  bool ready = false;

  Locale get locale => Locale(lang);

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    lang = prefs.getString(_langKey) == 'en' ? 'en' : 'es';
    themeMode = prefs.getString(_themeKey) == 'light' ? ThemeMode.light : ThemeMode.dark;
    ready = true;
    notifyListeners();
  }

  Future<void> setLang(String next) async {
    lang = next == 'en' ? 'en' : 'es';
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_langKey, lang);
    notifyListeners();
  }

  Future<void> setTheme(ThemeMode next) async {
    themeMode = next;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_themeKey, next == ThemeMode.light ? 'light' : 'dark');
    notifyListeners();
  }

  String t(String key) {
    final table = lang == 'en' ? _en : _es;
    return table[key] ?? _es[key] ?? key;
  }
}

const _es = {
  'board.kicker': 'Tablero',
  'board.search': 'Buscar en las notas…',
  'board.emptyTitle': 'Corcho vacío',
  'board.emptyBody': 'Añade una nota para este día. En tablet se abre al lado; en el celular, a pantalla completa.',
  'board.record': 'Grabar',
  'board.settings': 'Ajustes',
  'account.open': 'Cuenta',
  'account.language': 'Idioma',
  'account.spanish': 'Español',
  'account.english': 'English',
  'account.color': 'Color',
  'account.light': 'Claro',
  'account.dark': 'Oscuro',
  'account.logout': 'Cerrar sesión',
  'login.headline': 'Tu tablero del día',
  'login.lede': 'Disfruta creando tus notas diarias, notas de voz e incluso crea recordatorios en tus notas!',
};

const _en = {
  'board.kicker': 'Board',
  'board.search': 'Search notes…',
  'board.emptyTitle': 'Empty cork board',
  'board.emptyBody': 'Add a note for this day. On tablet it opens beside the board; on phone, full screen.',
  'board.record': 'Record',
  'board.settings': 'Settings',
  'account.open': 'Account',
  'account.language': 'Language',
  'account.spanish': 'Español',
  'account.english': 'English',
  'account.color': 'Color',
  'account.light': 'Light',
  'account.dark': 'Dark',
  'account.logout': 'Log out',
  'login.headline': 'Your board for the day',
  'login.lede': 'Enjoy creating your daily notes, voice notes, and even reminders on your notes!',
};
