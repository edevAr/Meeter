import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';
import 'detail_screen.dart';
import 'record_screen.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  Dashboard? _data;
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
      final data = await context.read<ApiClient>().getDashboard();
      if (!mounted) return;
      setState(() => _data = data);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: kAccent,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text('Dashboard', style: TextStyle(color: kText, fontSize: 28, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          const Text(
            'Capture a conversation, then turn it into decisions and action items.',
            style: TextStyle(color: kMuted, fontSize: 14),
          ),
          const SizedBox(height: 18),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: kRec, foregroundColor: Colors.white),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const RecordScreen(standalone: true)),
              ),
              child: const Text('Start recording'),
            ),
          ),
          if (_error.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(_error, style: const TextStyle(color: kDanger)),
          ],
          if (_loading && _data == null) const Padding(
            padding: EdgeInsets.only(top: 24),
            child: Center(child: CircularProgressIndicator(color: kAccent)),
          ),
          if (_data != null) ...[
            const SizedBox(height: 18),
            Row(
              children: [
                StatCard(title: 'Recordings', value: '${_data!.recordings}'),
                const SizedBox(width: 10),
                StatCard(title: 'Transcribed', value: '${_data!.transcribed}'),
                const SizedBox(width: 10),
                StatCard(title: 'AI Analyzed', value: '${_data!.analyzed}'),
              ],
            ),
            const SizedBox(height: 22),
            const Text('Recent recordings', style: TextStyle(color: kText, fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            if (_data!.recent.isEmpty)
              const EmptyState(title: 'No recordings yet', body: 'Tap Start recording to capture your first meeting.')
            else
              ..._data!.recent.map(
                (item) => RecordingCard(
                  recording: item,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => DetailScreen(recordingId: item.id)),
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
