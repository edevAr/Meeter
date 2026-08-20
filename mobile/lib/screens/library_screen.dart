import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';
import 'detail_screen.dart';
import 'search_screen.dart';

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key});

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  final _query = TextEditingController();
  List<Recording> _items = [];
  String _error = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _error = '';
      _loading = true;
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

  @override
  Widget build(BuildContext context) {
    final transcribed = _items
        .where((item) => {'transcribed', 'analyzing', 'analyzed'}.contains(item.status))
        .toList();
    return RefreshIndicator(
      color: kAccent,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text('Recordings', style: TextStyle(color: kText, fontSize: 28, fontWeight: FontWeight.w800)),
          const SizedBox(height: 14),
          TextField(
            controller: _query,
            style: const TextStyle(color: kText),
            textInputAction: TextInputAction.search,
            decoration: const InputDecoration(hintText: 'Search meetings, transcripts and action items...'),
            onSubmitted: (value) {
              if (value.trim().length >= 2) {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => SearchScreen(query: value.trim())),
                );
              }
            },
          ),
          if (_error.isNotEmpty) Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(_error, style: const TextStyle(color: kDanger)),
          ),
          if (_loading && _items.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 24),
              child: Center(child: CircularProgressIndicator(color: kAccent)),
            ),
          const SizedBox(height: 16),
          if (_items.isEmpty && !_loading)
            const EmptyState(
              title: 'No recordings',
              body: 'Record from the Record tab. Audio stays on this phone until you upload it to your API.',
            )
          else
            ..._items.map(
              (item) => RecordingCard(
                recording: item,
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => DetailScreen(recordingId: item.id)),
                ),
              ),
            ),
          const SizedBox(height: 12),
          const Text('Transcriptions', style: TextStyle(color: kText, fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          if (transcribed.isEmpty)
            const Text('Transcribe a recording to see it here.', style: TextStyle(color: kMuted))
          else
            ...transcribed.map(
              (item) => RecordingCard(
                recording: item,
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => DetailScreen(recordingId: item.id)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
