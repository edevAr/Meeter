import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'models.dart';
import 'theme.dart';

class CorkBackdrop extends StatelessWidget {
  const CorkBackdrop({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final light = Theme.of(context).brightness == Brightness.light;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: light
              ? const [Color(0xFFE8CBA0), Color(0xFFD4B07A), Color(0xFFC49A62)]
              : const [Color(0xFF8A5A32), kCork, kCorkDeep],
        ),
      ),
      child: CustomPaint(painter: _CorkPainter(light: light), child: child),
    );
  }
}

class _CorkPainter extends CustomPainter {
  const _CorkPainter({required this.light});

  final bool light;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = light ? const Color(0x22000000) : const Color(0x33000000);
    for (var y = 12.0; y < size.height; y += 28) {
      for (var x = 10.0; x < size.width; x += 26) {
        canvas.drawCircle(Offset(x + ((y / 28).floor().isEven ? 6 : 0), y), 1.4, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _CorkPainter oldDelegate) => oldDelegate.light != light;
}

class PaperCard extends StatelessWidget {
  const PaperCard({super.key, required this.child, this.padding = const EdgeInsets.all(20), this.color});

  final Widget child;
  final EdgeInsets padding;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? kPaper,
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [BoxShadow(color: Color(0x66000000), blurRadius: 18, offset: Offset(0, 10))],
      ),
      child: child,
    );
  }
}

class EmptyHint extends StatelessWidget {
  const EmptyHint({super.key, required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return PaperCard(
      child: Column(
        children: [
          Text(title, style: GoogleFonts.nunito(fontWeight: FontWeight.w800, fontSize: 18, color: kInk)),
          const SizedBox(height: 6),
          Text(body, textAlign: TextAlign.center, style: const TextStyle(color: kMuted)),
        ],
      ),
    );
  }
}

class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(label, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w800)),
    );
  }
}

class StickyCard extends StatelessWidget {
  const StickyCard({super.key, required this.note, required this.onTap, this.tilt = -1.5});

  final Note note;
  final VoidCallback onTap;
  final double tilt;

  @override
  Widget build(BuildContext context) {
    return Transform.rotate(
      angle: tilt * 3.1416 / 180,
      child: Material(
        color: noteColorOf(note.color),
        elevation: 6,
        shadowColor: const Color(0x66000000),
        borderRadius: BorderRadius.circular(4),
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 14, 12, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        note.title.trim().isEmpty ? 'Sin título' : note.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.caveat(fontSize: 22, fontWeight: FontWeight.w700, color: kInk, height: 1.05),
                      ),
                    ),
                    if (note.shareCount > 0 || !note.isOwner)
                      const Icon(Icons.ios_share, size: 14, color: kInk),
                  ],
                ),
                const SizedBox(height: 6),
                Expanded(
                  child: Text(
                    note.plainText.isEmpty ? 'Nota vacía' : note.plainText,
                    maxLines: 7,
                    overflow: TextOverflow.ellipsis,
                    style: GoogleFonts.nunito(fontSize: 13, color: kInk.withValues(alpha: 0.86), height: 1.35),
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    _PriorityDots(priority: note.priority),
                    const Spacer(),
                    if (!note.isOwner)
                      Text(
                        note.access == 'write' ? 'Editar' : 'Leer',
                        style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: kMuted),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PriorityDots extends StatelessWidget {
  const _PriorityDots({required this.priority});
  final int priority;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: List.generate(
        5,
        (index) => Container(
          width: 7,
          height: 7,
          margin: const EdgeInsets.only(right: 3),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: index < priority ? kInk : kInk.withValues(alpha: 0.18),
          ),
        ),
      ),
    );
  }
}

class PageHeader extends StatelessWidget {
  const PageHeader({super.key, required this.kicker, required this.title, this.actions});

  final String kicker;
  final String title;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) {
    final canPop = Navigator.of(context).canPop();
    final header = headerOnCork(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(pagePadding(context), 8, pagePadding(context), 12),
      child: Row(
        children: [
          if (canPop)
            IconButton(
              onPressed: () => Navigator.of(context).pop(),
              color: header,
              icon: const Icon(Icons.arrow_back),
            ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  kicker.toUpperCase(),
                  style: GoogleFonts.nunito(
                    color: header.withValues(alpha: 0.72),
                    fontSize: 11,
                    letterSpacing: 2.2,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Text(
                  title,
                  style: GoogleFonts.nunito(color: header, fontSize: isTablet(context) ? 32 : 26, fontWeight: FontWeight.w800),
                ),
              ],
            ),
          ),
          ...?actions,
        ],
      ),
    );
  }
}
