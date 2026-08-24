import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import 'api.dart';
import 'prefs.dart';
import 'theme.dart';

String accountInitials(String? name, String? email) {
  final source = (name ?? '').trim().isNotEmpty ? name!.trim() : (email ?? '').trim();
  if (source.isEmpty) return 'M';
  final parts = source.split(RegExp(r'\s+')).where((part) => part.isNotEmpty).toList();
  if (parts.length >= 2) return '${parts.first[0]}${parts[1][0]}'.toUpperCase();
  final token = parts.first;
  if (token.contains('@')) return token[0].toUpperCase();
  return token.substring(0, token.length >= 2 ? 2 : 1).toUpperCase();
}

class AccountAvatarButton extends StatelessWidget {
  const AccountAvatarButton({super.key});

  @override
  Widget build(BuildContext context) {
    final api = context.watch<ApiClient>();
    final initials = accountInitials(api.user?.name, api.user?.email);
    return IconButton(
      tooltip: context.watch<PrefsController>().t('account.open'),
      onPressed: () => _open(context),
      icon: CircleAvatar(
        radius: 16,
        backgroundColor: kSun,
        foregroundColor: kInk,
        child: Text(initials, style: GoogleFonts.nunito(fontWeight: FontWeight.w800, fontSize: 12, color: kInk)),
      ),
    );
  }

  Future<void> _open(BuildContext context) async {
    final box = context.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return;
    final origin = box.localToGlobal(Offset.zero);
    final size = box.size;
    final screen = MediaQuery.sizeOf(context);
    await showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'account',
      barrierColor: const Color(0x33000000),
      transitionDuration: const Duration(milliseconds: 160),
      pageBuilder: (context, animation, secondary) {
        return const SizedBox.shrink();
      },
      transitionBuilder: (context, animation, secondary, child) {
        final prefs = context.watch<PrefsController>();
        final api = context.watch<ApiClient>();
        final fade = CurvedAnimation(parent: animation, curve: Curves.easeOutCubic);
        return FadeTransition(
          opacity: fade,
          child: Stack(
            children: [
              Positioned.fill(
                child: GestureDetector(onTap: () => Navigator.of(context).pop()),
              ),
              Positioned(
                top: origin.dy + size.height + 6,
                right: (screen.width - origin.dx - size.width).clamp(12, screen.width - 272),
                child: ScaleTransition(
                  scale: Tween(begin: 0.96, end: 1.0).animate(fade),
                  alignment: Alignment.topRight,
                  child: AccountMenuCard(
                    name: api.user?.name.isNotEmpty == true ? api.user!.name : 'Meeter',
                    email: api.user?.email ?? '',
                    initials: accountInitials(api.user?.name, api.user?.email),
                    lang: prefs.lang,
                    dark: prefs.themeMode != ThemeMode.light,
                    onLang: (value) => prefs.setLang(value),
                    onTheme: (dark) => prefs.setTheme(dark ? ThemeMode.dark : ThemeMode.light),
                    onLogout: () {
                      Navigator.of(context).pop();
                      api.logout();
                    },
                    t: prefs.t,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class AccountMenuCard extends StatelessWidget {
  const AccountMenuCard({
    super.key,
    required this.name,
    required this.email,
    required this.initials,
    required this.lang,
    required this.dark,
    required this.onLang,
    required this.onTheme,
    required this.onLogout,
    required this.t,
  });

  final String name;
  final String email;
  final String initials;
  final String lang;
  final bool dark;
  final ValueChanged<String> onLang;
  final ValueChanged<bool> onTheme;
  final VoidCallback onLogout;
  final String Function(String) t;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: Container(
        width: 248,
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF8E6),
          borderRadius: BorderRadius.circular(18),
          boxShadow: const [
            BoxShadow(color: Color(0x66000000), blurRadius: 24, offset: Offset(0, 12)),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 42,
                height: 8,
                decoration: BoxDecoration(color: const Color(0x66C23B22), borderRadius: BorderRadius.circular(4)),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                CircleAvatar(
                  radius: 16,
                  backgroundColor: kSun,
                  child: Text(initials, style: GoogleFonts.nunito(fontWeight: FontWeight.w800, fontSize: 12, color: kInk)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: GoogleFonts.nunito(fontWeight: FontWeight.w800, fontSize: 14, color: kInk)),
                      if (email.isNotEmpty)
                        Text(email, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: kMuted, fontSize: 11)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            _label(t('account.language')),
            const SizedBox(height: 6),
            _segment(
              left: t('account.spanish'),
              right: t('account.english'),
              leftOn: lang != 'en',
              onLeft: () => onLang('es'),
              onRight: () => onLang('en'),
            ),
            const SizedBox(height: 12),
            _label(t('account.color')),
            const SizedBox(height: 6),
            _segment(
              left: t('account.light'),
              right: t('account.dark'),
              leftOn: !dark,
              onLeft: () => onTheme(false),
              onRight: () => onTheme(true),
              leftIcon: Icons.wb_sunny_outlined,
              rightIcon: Icons.nights_stay_outlined,
            ),
            const SizedBox(height: 12),
            TextButton.icon(
              onPressed: onLogout,
              icon: const Icon(Icons.logout, size: 16, color: kDanger),
              label: Text(t('account.logout'), style: const TextStyle(color: kDanger, fontWeight: FontWeight.w800)),
              style: TextButton.styleFrom(
                alignment: Alignment.centerLeft,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _label(String text) {
    return Text(
      text.toUpperCase(),
      style: GoogleFonts.nunito(color: kMuted, fontSize: 10, letterSpacing: 1.4, fontWeight: FontWeight.w800),
    );
  }

  Widget _segment({
    required String left,
    required String right,
    required bool leftOn,
    required VoidCallback onLeft,
    required VoidCallback onRight,
    IconData? leftIcon,
    IconData? rightIcon,
  }) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: const Color(0x1A3B2A12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        children: [
          Expanded(child: _chip(left, leftOn, onLeft, leftIcon)),
          Expanded(child: _chip(right, !leftOn, onRight, rightIcon)),
        ],
      ),
    );
  }

  Widget _chip(String label, bool on, VoidCallback onTap, IconData? icon) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(vertical: 7),
        decoration: BoxDecoration(
          color: on ? kSun : Colors.transparent,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 13, color: kInk),
              const SizedBox(width: 4),
            ],
            Text(label, style: GoogleFonts.nunito(fontSize: 11, fontWeight: FontWeight.w800, color: kInk)),
          ],
        ),
      ),
    );
  }
}
