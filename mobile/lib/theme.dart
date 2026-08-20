import 'package:flutter/material.dart';

const Color kBg = Color(0xFF0B0C10);
const Color kSidebar = Color(0xFF101218);
const Color kCard = Color(0xFF181A23);
const Color kBorder = Color(0xFF2A2D3A);
const Color kText = Color(0xFFF4F5FB);
const Color kMuted = Color(0xFF8D91A7);
const Color kAccent = Color(0xFF6C75F1);
const Color kRec = Color(0xFFFF5C5C);
const Color kSuccess = Color(0xFF3ECF8E);
const Color kWarning = Color(0xFFF5C14A);
const Color kDanger = Color(0xFFFF6B6B);
const Color kInfo = Color(0xFF5BBCFF);

Color statusColor(String status) {
  switch (status) {
    case 'recording':
      return kRec;
    case 'paused':
    case 'pending':
    case 'medium':
      return kWarning;
    case 'recorded':
    case 'in_progress':
      return kInfo;
    case 'transcribing':
    case 'transcribed':
    case 'analyzing':
      return kAccent;
    case 'analyzed':
    case 'completed':
      return kSuccess;
    case 'failed':
    case 'high':
      return kDanger;
    default:
      return kMuted;
  }
}

String statusLabel(String status) {
  switch (status) {
    case 'recorded':
      return 'Recorded';
    case 'transcribing':
      return 'Transcribing';
    case 'transcribed':
      return 'Transcribed';
    case 'analyzing':
      return 'Analyzing';
    case 'analyzed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'pending':
      return 'Pending';
    case 'completed':
      return 'Done';
    case 'in_progress':
      return 'In progress';
    default:
      return status;
  }
}

String formatDuration(num seconds) {
  final total = seconds.floor().clamp(0, 1 << 31);
  final hours = total ~/ 3600;
  final minutes = (total % 3600) ~/ 60;
  final secs = total % 60;
  if (hours > 0) return '$hours hr $minutes min';
  if (minutes > 0) return '$minutes min';
  return '$secs sec';
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
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${months[date.month - 1]} ${date.day}, ${date.year}';
}

ThemeData buildAppTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: kBg,
    colorScheme: base.colorScheme.copyWith(
      primary: kAccent,
      surface: kCard,
      error: kDanger,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: kBg,
      foregroundColor: kText,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: kSidebar,
      selectedItemColor: kAccent,
      unselectedItemColor: kMuted,
      type: BottomNavigationBarType.fixed,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: const Color(0xFF15171F),
      hintStyle: const TextStyle(color: kMuted),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: kBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: kAccent),
      ),
    ),
  );
}
