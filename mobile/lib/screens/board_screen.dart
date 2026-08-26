import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../account_menu.dart';
import '../models.dart';
import '../note_store.dart';
import '../prefs.dart';
import '../theme.dart';
import '../widgets.dart';
import 'capture_screen.dart';
import 'note_editor.dart';
import 'settings_screen.dart';

class BoardScreen extends StatefulWidget {
  const BoardScreen({super.key});

  @override
  State<BoardScreen> createState() => _BoardScreenState();
}

class _BoardScreenState extends State<BoardScreen> with WidgetsBindingObserver {
  DateTime _day = DateTime.now();
  Note? _selected;
  String _query = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<NoteStore>().refresh();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && mounted) {
      context.read<NoteStore>().refresh();
    }
  }

  List<Note> _visible(List<Note> notes) {
    final key = dayKey(_day);
    return notes.where((note) {
      if (note.archived || note.pinned) return false;
      final created = DateTime.tryParse(note.createdAt)?.toLocal();
      if (created == null || dayKey(created) != key) return false;
      if (_query.trim().isEmpty) return true;
      final hay = '${note.title} ${note.plainText}'.toLowerCase();
      return hay.contains(_query.trim().toLowerCase());
    }).toList()
      ..sort((a, b) => a.priority.compareTo(b.priority));
  }

  Future<void> _add() async {
    final created = context.read<NoteStore>().createNote(day: _day);
    await _open(created);
  }

  Future<void> _open(Note note) async {
    if (isTablet(context)) {
      setState(() => _selected = note);
      return;
    }
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => NoteEditor(note: note)));
    if (mounted) setState(() {});
  }

  Future<void> _pickDay() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _day,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 800)),
    );
    if (picked != null) setState(() => _day = picked);
  }

  @override
  Widget build(BuildContext context) {
    final prefs = context.watch<PrefsController>();
    final store = context.watch<NoteStore>();
    final header = headerOnCork(context);
    final tablet = isTablet(context);
    final notes = _visible(store.notes);
    final grid = RefreshIndicator(
      color: kSun,
      onRefresh: store.refresh,
      child: CustomScrollView(
        slivers: [
          SliverToBoxAdapter(
            child: PageHeader(
              kicker: prefs.t('board.kicker'),
              title: dayLabel(_day, lang: prefs.lang),
              actions: [
                if (tablet) ...[
                  IconButton(
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const CaptureScreen())),
                    color: header,
                    tooltip: prefs.t('board.record'),
                    icon: const Icon(Icons.mic_none),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const SettingsScreen())),
                    color: header,
                    tooltip: prefs.t('board.settings'),
                    icon: const Icon(Icons.settings_outlined),
                  ),
                ] else
                  PopupMenuButton<String>(
                    icon: Icon(Icons.more_horiz, color: header),
                    color: kPaper,
                    onSelected: (value) {
                      final page = value == 'capture'
                          ? const CaptureScreen()
                          : const SettingsScreen();
                      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page));
                    },
                    itemBuilder: (context) => [
                      PopupMenuItem(value: 'capture', child: Text(prefs.t('board.record'))),
                      PopupMenuItem(value: 'settings', child: Text(prefs.t('board.settings'))),
                    ],
                  ),
                IconButton(onPressed: _pickDay, color: header, icon: const Icon(Icons.calendar_month_outlined)),
                IconButton(onPressed: _add, color: kSun, icon: const Icon(Icons.note_add_outlined)),
                const AccountAvatarButton(),
              ],
            ),
          ),
          if (!store.online || store.syncing || store.pending > 0)
            SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(pagePadding(context), 0, pagePadding(context), 8),
                child: Text(
                  store.online ? prefs.t('sync.pending') : prefs.t('sync.offline'),
                  style: TextStyle(
                    color: store.online ? header.withValues(alpha: 0.8) : kSun,
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                  ),
                ),
              ),
            ),
          SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.fromLTRB(pagePadding(context), 0, pagePadding(context), 12),
              child: TextField(
                style: const TextStyle(color: kInk),
                decoration: InputDecoration(hintText: prefs.t('board.search'), prefixIcon: const Icon(Icons.search)),
                onChanged: (value) => setState(() => _query = value),
              ),
            ),
          ),
          if (notes.isEmpty)
            SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.all(pagePadding(context)),
                child: EmptyHint(
                  title: prefs.t('board.emptyTitle'),
                  body: prefs.t('board.emptyBody'),
                ),
              ),
            )
          else
            SliverPadding(
              padding: EdgeInsets.fromLTRB(pagePadding(context), 4, pagePadding(context), 100),
              sliver: SliverGrid(
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: tablet && _selected != null ? 2 : noteColumns(context),
                  mainAxisSpacing: 16,
                  crossAxisSpacing: 16,
                  childAspectRatio: 0.78,
                ),
                delegate: SliverChildBuilderDelegate(
                  (context, index) {
                    final note = notes[index];
                    return StickyCard(
                      note: note,
                      tilt: index.isEven ? -2.2 : 1.8,
                      onTap: () => _open(note),
                    );
                  },
                  childCount: notes.length,
                ),
              ),
            ),
        ],
      ),
    );

    if (!tablet) return CorkBackdrop(child: SafeArea(child: grid));
    return CorkBackdrop(
      child: SafeArea(
        child: Row(
          children: [
            Expanded(flex: _selected == null ? 1 : 3, child: grid),
            if (_selected != null)
              Expanded(
                flex: 2,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(0, 12, 16, 16),
                  child: NoteEditor(
                    note: _selected!,
                    embedded: true,
                    onClose: () => setState(() => _selected = null),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
