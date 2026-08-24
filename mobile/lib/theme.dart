import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

const Color kCork = Color(0xFF6F4B2B);
const Color kCorkDeep = Color(0xFF4A2F18);
const Color kPaper = Color(0xFFFFF8E6);
const Color kInk = Color(0xFF3B2A12);
const Color kMuted = Color(0xFF7A5A28);
const Color kSun = Color(0xFFFFE45C);
const Color kAccent = Color(0xFFE0A12B);
const Color kRec = Color(0xFFC23B22);
const Color kMint = Color(0xFF3B9A5A);
const Color kSky = Color(0xFF3B7DD8);
const Color kDanger = Color(0xFF8A2A1A);
const Color kCream = Color(0xFFF8ECD4);

const notePalette = <String, Color>{
  'yellow': Color(0xFFFFE45C),
  'amber': Color(0xFFFFB14A),
  'peach': Color(0xFFFFC39A),
  'rose': Color(0xFFFFB0C4),
  'lilac': Color(0xFFD4B8FF),
  'sky': Color(0xFF8ECDF5),
  'mint': Color(0xFF8EE0B5),
};

const noteLabels = <String, String>{
  'yellow': 'Amarillo',
  'amber': 'Naranja',
  'peach': 'Durazno',
  'rose': 'Rosa',
  'lilac': 'Lila',
  'sky': 'Cielo',
  'mint': 'Menta',
};

bool isTablet(BuildContext context) => MediaQuery.sizeOf(context).shortestSide >= 600;

double pagePadding(BuildContext context) => isTablet(context) ? 28 : 16;

int noteColumns(BuildContext context) {
  final width = MediaQuery.sizeOf(context).width;
  if (width >= 1200) return 4;
  if (width >= 840) return 3;
  if (width >= 600) return 2;
  return 2;
}

Color noteColorOf(String? id) => notePalette[id] ?? notePalette['yellow']!;

Color statusColor(String status) {
  switch (status) {
    case 'recording':
    case 'failed':
    case 'high':
      return kRec;
    case 'paused':
    case 'pending':
    case 'medium':
      return kAccent;
    case 'analyzed':
    case 'completed':
    case 'low':
      return kMint;
    case 'transcribed':
    case 'transcribing':
    case 'analyzing':
      return kSky;
    default:
      return kMuted;
  }
}

String statusLabel(String status) {
  switch (status) {
    case 'recorded':
      return 'Grabada';
    case 'transcribing':
      return 'Transcribiendo';
    case 'transcribed':
      return 'Transcrita';
    case 'analyzing':
      return 'Analizando';
    case 'analyzed':
      return 'Lista';
    case 'failed':
      return 'Error';
    case 'pending':
      return 'Pendiente';
    case 'completed':
      return 'Hecha';
    case 'in_progress':
      return 'En curso';
    default:
      return status;
  }
}

String formatDuration(num seconds) {
  final total = seconds.floor().clamp(0, 1 << 31);
  final hours = total ~/ 3600;
  final minutes = (total % 3600) ~/ 60;
  final secs = total % 60;
  if (hours > 0) return '$hours h $minutes min';
  if (minutes > 0) return '$minutes min';
  return '$secs s';
}

String formatClock(Duration duration) {
  final total = duration.inSeconds.clamp(0, 1 << 31);
  final hours = total ~/ 3600;
  final minutes = (total % 3600) ~/ 60;
  final seconds = total % 60;
  String two(int n) => n.toString().padLeft(2, '0');
  if (hours > 0) return '${two(hours)}:${two(minutes)}:${two(seconds)}';
  return '${two(minutes)}:${two(seconds)}';
}

String formatDate(String iso) {
  final date = DateTime.tryParse(iso)?.toLocal();
  if (date == null) return iso;
  const months = [
    'ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
  ];
  return '${date.day} ${months[date.month - 1]} ${date.year}';
}

String dayKey(DateTime date) =>
    '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

String dayLabel(DateTime date, {String lang = 'es'}) {
  if (lang == 'en') {
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return '${weekdays[date.weekday - 1]}, ${months[date.month - 1]} ${date.day}';
  }
  const weekdays = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return '${weekdays[date.weekday - 1]}, ${date.day} de ${months[date.month - 1]}';
}

Color headerOnCork(BuildContext context) =>
    Theme.of(context).brightness == Brightness.light ? kInk : kCream;

ThemeData buildAppTheme({Brightness brightness = Brightness.dark}) {
  final light = brightness == Brightness.light;
  final header = light ? kInk : kCream;
  final text = GoogleFonts.nunitoTextTheme(ThemeData.light().textTheme).apply(
    bodyColor: kInk,
    displayColor: kInk,
  );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    scaffoldBackgroundColor: light ? const Color(0xFFD4B07A) : kCork,
    colorScheme: ColorScheme(
      brightness: brightness,
      primary: kInk,
      onPrimary: kSun,
      secondary: kAccent,
      onSecondary: kInk,
      surface: kPaper,
      onSurface: kInk,
      error: kDanger,
      onError: kPaper,
    ),
    textTheme: text,
    appBarTheme: AppBarTheme(
      backgroundColor: Colors.transparent,
      foregroundColor: header,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: GoogleFonts.nunito(
        color: header,
        fontSize: 20,
        fontWeight: FontWeight.w800,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: kCorkDeep,
      indicatorColor: kSun.withValues(alpha: 0.9),
      labelTextStyle: WidgetStatePropertyAll(
        GoogleFonts.nunito(fontSize: 12, fontWeight: FontWeight.w700, color: kCream),
      ),
    ),
    navigationRailTheme: NavigationRailThemeData(
      backgroundColor: kCorkDeep,
      selectedIconTheme: const IconThemeData(color: kInk),
      unselectedIconTheme: const IconThemeData(color: kCream),
      selectedLabelTextStyle: GoogleFonts.nunito(color: kSun, fontWeight: FontWeight.w800),
      unselectedLabelTextStyle: GoogleFonts.nunito(color: kCream),
      indicatorColor: kSun,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: kPaper,
      hintStyle: TextStyle(color: kMuted.withValues(alpha: 0.8)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: kInk.withValues(alpha: 0.12)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: kInk, width: 1.4),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: kInk,
        foregroundColor: kSun,
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        textStyle: GoogleFonts.nunito(fontWeight: FontWeight.w800),
      ),
    ),
  );
}
