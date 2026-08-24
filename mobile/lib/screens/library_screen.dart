import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';
import 'detail_screen.dart';

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key});

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  List<Recording> _items = [];
  Recording? _selected;
  bool _loading = true;
  String _error = '';
  String _query = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final items = await context.read<ApiClient>().listRecordings();
      if (!mounted) return;
      setState(() => _items = items);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Recording> get _visible {
    if (_query.trim().isEmpty) return _items;
    final q = _query.trim().toLowerCase();
    return _items.where((item) => item.title.toLowerCase().contains(q)).toList();
  }

  void _open(Recording recording) {
    if (isTablet(context)) {
      setState(() => _selected = recording);
      return;
    }
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => DetailScreen(recordingId: recording.id)));
  }

  @override
  Widget build(BuildContext context) {
    final tablet = isTablet(context);
    final list = RefreshIndicator(
      color: kSun,
      onRefresh: _load,
      child: ListView(
        padding: EdgeInsets.fromLTRB(pagePadding(context), 8, pagePadding(context), 24),
        children: [
          const PageHeader(kicker: 'Archivo', title: 'Llamadas'),
          TextField(
            style: const TextStyle(color: kInk),
            decoration: const InputDecoration(hintText: 'Buscar por título…', prefixIcon: Icon(Icons.search)),
            onChanged: (value) => setState(() => _query = value),
          ),
          const SizedBox(height: 12),
          if (_error.isNotEmpty) Text(_error, style: const TextStyle(color: kSun, fontWeight: FontWeight.w700)),
          if (_loading && _items.isEmpty) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator(color: kSun))),
          if (!_loading && _visible.isEmpty)
            const EmptyHint(title: 'Sin llamadas', body: 'Graba desde Captura. El audio se sube a tu API y luego se transcribe.'),
          ..._visible.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Material(
                color: kPaper,
                borderRadius: BorderRadius.circular(16),
                child: ListTile(
                  selected: _selected?.id == item.id,
                  selectedTileColor: kSun.withValues(alpha: 0.35),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  title: Text(item.title, style: const TextStyle(fontWeight: FontWeight.w800)),
                  subtitle: Text('${formatDate(item.createdAt)} · ${formatDuration(item.durationSeconds)}'),
                  trailing: StatusChip(label: statusLabel(item.status), color: statusColor(item.status)),
                  onTap: () => _open(item),
                ),
              ),
            ),
          ),
        ],
      ),
    );

    if (!tablet) return CorkBackdrop(child: SafeArea(child: list));
    return CorkBackdrop(
      child: SafeArea(
        child: Row(
          children: [
            Expanded(flex: 2, child: list),
            Expanded(
              flex: 3,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(0, 12, 16, 16),
                child: _selected == null
                    ? const EmptyHint(title: 'Elige una llamada', body: 'En tablet el detalle se abre aquí, sin salir de la lista.')
                    : DetailScreen(key: ValueKey(_selected!.id), recordingId: _selected!.id, embedded: true),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
