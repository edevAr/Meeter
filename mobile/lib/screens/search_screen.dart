import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';
import 'detail_screen.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key, required this.query});

  final String query;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  List<SearchHit> _hits = [];
  String _error = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _run();
  }

  Future<void> _run() async {
    try {
      final hits = await context.read<ApiClient>().search(widget.query);
      if (!mounted) return;
      setState(() => _hits = hits);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Search')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Search · “${widget.query}”', style: const TextStyle(color: kText, fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 16),
          if (_loading) const Center(child: CircularProgressIndicator(color: kAccent)),
          if (_error.isNotEmpty) Text(_error, style: const TextStyle(color: kDanger)),
          if (!_loading && _hits.isEmpty)
            const EmptyState(title: 'No matches', body: 'Try another name, topic or action item.')
          else
            ..._hits.map(
              (hit) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Material(
                  color: kCard,
                  borderRadius: BorderRadius.circular(16),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(16),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(builder: (_) => DetailScreen(recordingId: hit.recordingId)),
                    ),
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: kBorder),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(hit.kind.toUpperCase(), style: const TextStyle(color: kAccent, fontSize: 11, fontWeight: FontWeight.w800)),
                          const SizedBox(height: 4),
                          Text(hit.title, style: const TextStyle(color: kText, fontSize: 16, fontWeight: FontWeight.w700)),
                          const SizedBox(height: 6),
                          Text(hit.snippet, style: const TextStyle(color: kMuted)),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
