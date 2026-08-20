import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';

class ActionItemsScreen extends StatefulWidget {
  const ActionItemsScreen({super.key});

  @override
  State<ActionItemsScreen> createState() => _ActionItemsScreenState();
}

class _ActionItemsScreenState extends State<ActionItemsScreen> {
  String _filter = 'all';
  List<ActionItem> _items = [];
  String _error = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _error = '';
      _loading = true;
    });
    try {
      final items = await context.read<ApiClient>().listActionItems(
            status: _filter == 'pending' || _filter == 'completed' ? _filter : null,
            highPriority: _filter == 'high',
          );
      if (!mounted) return;
      setState(() => _items = items);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggle(ActionItem item) async {
    final status = item.status == 'completed' ? 'pending' : 'completed';
    await context.read<ApiClient>().patchActionItem(item.id, {'status': status});
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    const filters = [
      ('all', 'All'),
      ('pending', 'Pending'),
      ('completed', 'Completed'),
      ('high', 'High priority'),
    ];
    return RefreshIndicator(
      color: kAccent,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text('Action Items', style: TextStyle(color: kText, fontSize: 28, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          const Text('Tasks extracted from every conversation.', style: TextStyle(color: kMuted)),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final filter in filters)
                ChoiceChip(
                  label: Text(filter.$2),
                  selected: _filter == filter.$1,
                  onSelected: (_) {
                    setState(() => _filter = filter.$1);
                    _load();
                  },
                ),
            ],
          ),
          if (_error.isNotEmpty) Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(_error, style: const TextStyle(color: kDanger)),
          ),
          const SizedBox(height: 16),
          if (_items.isEmpty && !_loading)
            const EmptyState(title: 'No action items', body: 'Analyze a transcript to extract tasks automatically.')
          else
            ..._items.map(
              (item) => Container(
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: kCard,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: kBorder),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.task, style: const TextStyle(color: kText, fontSize: 16, fontWeight: FontWeight.w700)),
                    Text(item.recordingTitle ?? 'Meeting', style: const TextStyle(color: kMuted)),
                    Text('Owner: ${item.displayOwner} · Due: ${item.displayDue}', style: const TextStyle(color: kMuted)),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        StatusBadge(text: item.priority, color: statusColor(item.priority)),
                        const SizedBox(width: 8),
                        StatusBadge(text: item.status.replaceAll('_', ' '), color: statusColor(item.status)),
                        const Spacer(),
                        TextButton(
                          onPressed: () => _toggle(item),
                          child: Text(item.status == 'completed' ? 'Reopen' : 'Mark done'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
