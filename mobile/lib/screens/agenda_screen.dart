import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';

class AgendaScreen extends StatefulWidget {
  const AgendaScreen({super.key});

  @override
  State<AgendaScreen> createState() => _AgendaScreenState();
}

class _AgendaScreenState extends State<AgendaScreen> {
  String _period = 'day';
  List<AgendaItem> _items = [];
  final _title = TextEditingController();
  String _priority = 'medium';
  bool _loading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final items = await context.read<ApiClient>().listAgenda(_period);
      if (!mounted) return;
      setState(() => _items = items);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _add() async {
    if (_title.text.trim().isEmpty) return;
    await context.read<ApiClient>().createTask(title: _title.text.trim(), priority: _priority);
    _title.clear();
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final tablet = isTablet(context);
    return CorkBackdrop(
      child: SafeArea(
        child: RefreshIndicator(
        color: kSun,
        onRefresh: _load,
        child: ListView(
          padding: EdgeInsets.fromLTRB(pagePadding(context), 8, pagePadding(context), 32),
          children: [
            const PageHeader(kicker: 'Foco', title: 'Pendientes'),
            Center(
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: tablet ? 720 : 560),
                child: Column(
                  children: [
                    PaperCard(
                      child: Column(
                        children: [
                          SegmentedButton<String>(
                            segments: const [
                              ButtonSegment(value: 'day', label: Text('Hoy')),
                              ButtonSegment(value: 'week', label: Text('Semana')),
                              ButtonSegment(value: 'month', label: Text('Mes')),
                            ],
                            selected: {_period},
                            onSelectionChanged: (value) {
                              setState(() => _period = value.first);
                              _load();
                            },
                          ),
                          const SizedBox(height: 14),
                          if (tablet)
                            Row(
                              children: [
                                Expanded(child: TextField(controller: _title, decoration: const InputDecoration(hintText: 'Nuevo pendiente'))),
                                const SizedBox(width: 8),
                                DropdownButton<String>(
                                  value: _priority,
                                  items: const [
                                    DropdownMenuItem(value: 'low', child: Text('Baja')),
                                    DropdownMenuItem(value: 'medium', child: Text('Media')),
                                    DropdownMenuItem(value: 'high', child: Text('Alta')),
                                  ],
                                  onChanged: (value) => setState(() => _priority = value ?? 'medium'),
                                ),
                                const SizedBox(width: 8),
                                FilledButton(onPressed: _add, child: const Text('Añadir')),
                              ],
                            )
                          else ...[
                            TextField(controller: _title, decoration: const InputDecoration(hintText: 'Nuevo pendiente')),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: DropdownButtonFormField<String>(
                                    initialValue: _priority,
                                    items: const [
                                      DropdownMenuItem(value: 'low', child: Text('Baja')),
                                      DropdownMenuItem(value: 'medium', child: Text('Media')),
                                      DropdownMenuItem(value: 'high', child: Text('Alta')),
                                    ],
                                    onChanged: (value) => setState(() => _priority = value ?? 'medium'),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                FilledButton(onPressed: _add, child: const Text('Añadir')),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    if (_error.isNotEmpty) Text(_error, style: const TextStyle(color: kSun, fontWeight: FontWeight.w700)),
                    if (_loading && _items.isEmpty) const Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator(color: kSun)),
                    if (!_loading && _items.isEmpty)
                      const EmptyHint(title: 'Nada pendiente', body: 'Añade una tarea o espera a que una llamada deje action items.'),
                    ..._items.map(
                      (item) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: PaperCard(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(item.title, style: const TextStyle(fontWeight: FontWeight.w800)),
                                    if (item.dueDate != null) Text(item.dueDate!, style: const TextStyle(color: kMuted, fontSize: 12)),
                                  ],
                                ),
                              ),
                              StatusChip(label: statusLabel(item.priority), color: statusColor(item.priority)),
                              if (item.kind == 'task')
                                IconButton(
                                  onPressed: () async {
                                    await context.read<ApiClient>().patchTask(item.id, {'status': 'completed'});
                                    _load();
                                  },
                                  icon: const Icon(Icons.check_circle_outline, color: kMint),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
        ),
      ),
    );
  }
}
