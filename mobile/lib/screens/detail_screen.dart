import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';

class DetailScreen extends StatefulWidget {
  const DetailScreen({super.key, required this.recordingId, this.autostart});

  final String recordingId;
  final String? autostart;

  @override
  State<DetailScreen> createState() => _DetailScreenState();
}

class _DetailScreenState extends State<DetailScreen> {
  final _player = AudioPlayer();
  Recording? _recording;
  Transcript? _transcript;
  Analysis? _analysis;
  List<ActionItem> _items = [];
  String _error = '';
  String _busy = '';
  bool _started = false;

  ApiClient get _api => context.read<ApiClient>();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final recording = await _api.getRecording(widget.recordingId);
      final transcript = await _api.getTranscript(widget.recordingId);
      final analysis = await _api.getAnalysis(widget.recordingId);
      final items = await _api.listActionItems();
      if (!mounted) return;
      setState(() {
        _recording = recording;
        _transcript = transcript;
        _analysis = analysis;
        _items = items.where((item) => item.recordingId == widget.recordingId).toList();
        _error = '';
      });
      if (!_started && widget.autostart != null) {
        _started = true;
        if (widget.autostart == 'transcribe') await _transcribe();
        if (widget.autostart == 'analyze') await _analyze();
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    }
  }

  Future<void> _ensurePlayer() async {
    final recording = _recording;
    if (recording == null || _player.audioSource != null) return;
    await _player.setUrl(_api.audioUrl(recording));
  }

  Future<void> _togglePlay() async {
    await _ensurePlayer();
    if (_player.playing) {
      await _player.pause();
    } else {
      await _player.play();
    }
    setState(() {});
  }

  Future<void> _seekTo(double seconds) async {
    await _ensurePlayer();
    await _player.seek(Duration(milliseconds: (seconds * 1000).round()));
    await _player.play();
    setState(() {});
  }

  Future<void> _transcribe() async {
    setState(() {
      _busy = 'Transcribing…';
      _error = '';
    });
    try {
      final meta = await _api.getMeta();
      if (meta.transcriptionIsCloud && !meta.allowCloudTranscription) {
        throw ApiException('Cloud transcription is disabled. Enable it on the API (.env).');
      }
      await _api.transcribe(
        widget.recordingId,
        language: meta.defaultLanguage == 'auto' ? null : meta.defaultLanguage,
      );
      await _load();
      if (!mounted) return;
      final go = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          backgroundColor: kCard,
          title: const Text('Transcription ready', style: TextStyle(color: kText)),
          content: const Text('Analyze with AI now?', style: TextStyle(color: kMuted)),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Later')),
            TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Analyze')),
          ],
        ),
      );
      if (go == true) await _analyze();
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _analyze() async {
    final meta = await _api.getMeta();
    if (!mounted) return;
    if (meta.aiIsCloud) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          backgroundColor: kCard,
          title: const Text('Analyze with AI', style: TextStyle(color: kText)),
          content: const Text(
            'The transcript text will be sent to the configured LLM provider. Continue?',
            style: TextStyle(color: kMuted),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Continue')),
          ],
        ),
      );
      if (ok != true) return;
    }
    setState(() {
      _busy = 'Analyzing…';
      _error = '';
    });
    try {
      await _api.analyze(widget.recordingId);
      await _load();
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: kCard,
        title: const Text('Delete recording', style: TextStyle(color: kText)),
        content: const Text(
          'Permanently delete this recording, transcript and analysis?',
          style: TextStyle(color: kMuted),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    await _api.deleteRecording(widget.recordingId);
    if (mounted) Navigator.pop(context);
  }

  Future<void> _export(String kind, String format) async {
    final uri = Uri.parse(_api.exportUrl(widget.recordingId, kind, format));
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      setState(() => _error = 'Cannot open export URL. Check the API base URL in Settings.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final recording = _recording;
    return Scaffold(
      appBar: AppBar(title: const Text('Recording')),
      body: recording == null
          ? Center(
              child: _error.isEmpty
                  ? const CircularProgressIndicator(color: kAccent)
                  : Text(_error, style: const TextStyle(color: kDanger)),
            )
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(recording.title, style: const TextStyle(color: kText, fontSize: 24, fontWeight: FontWeight.w800)),
                const SizedBox(height: 6),
                Text(
                  '${formatDate(recording.createdAt)} · ${recording.source.replaceAll('_', ' ')}',
                  style: const TextStyle(color: kMuted),
                ),
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerLeft,
                  child: StatusBadge(text: statusLabel(recording.status), color: statusColor(recording.status)),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Recorded  →  Transcribing  →  Transcribed  →  Analyzing  →  Completed',
                  style: TextStyle(color: kMuted, fontSize: 12),
                ),
                const SizedBox(height: 12),
                StreamBuilder<Duration>(
                  stream: _player.positionStream,
                  builder: (context, snapshot) {
                    final position = snapshot.data ?? Duration.zero;
                    final duration = _player.duration ?? Duration.zero;
                    return FilledButton(
                      onPressed: _togglePlay,
                      child: Text(
                        '${_player.playing ? 'Pause' : 'Play'}  ${formatClock(position)} / ${formatClock(duration)}',
                      ),
                    );
                  },
                ),
                if (_error.isNotEmpty) Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(_error, style: const TextStyle(color: kDanger)),
                ),
                if (_busy.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Row(
                      children: [
                        const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: kAccent),
                        ),
                        const SizedBox(width: 10),
                        Text(_busy, style: const TextStyle(color: kMuted)),
                      ],
                    ),
                  ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(child: FilledButton(onPressed: _busy.isEmpty ? _transcribe : null, child: const Text('Transcribe'))),
                    const SizedBox(width: 8),
                    Expanded(child: FilledButton(onPressed: _busy.isEmpty ? _analyze : null, child: const Text('Analyze with AI'))),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => _export('transcript', 'md'),
                        child: const Text('Export transcript'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => _export('analysis', 'md'),
                        child: const Text('Export analysis'),
                      ),
                    ),
                  ],
                ),
                TextButton(
                  onPressed: _delete,
                  child: const Text('Delete', style: TextStyle(color: kDanger, fontWeight: FontWeight.w700)),
                ),
                const SizedBox(height: 12),
                const Text('Transcription', style: TextStyle(color: kText, fontSize: 18, fontWeight: FontWeight.w700)),
                const SizedBox(height: 10),
                if (_transcript == null)
                  const EmptyState(title: 'No transcript yet', body: 'Tap Transcribe when the recording is ready.')
                else if (_transcript!.segments.isNotEmpty)
                  ..._transcript!.segments.map(
                    (segment) => ListTile(
                      contentPadding: EdgeInsets.zero,
                      onTap: () => _seekTo(segment.startTime),
                      title: Text(
                        '${segment.speaker ?? 'Speaker'} · ${formatClock(Duration(milliseconds: (segment.startTime * 1000).round()))}',
                        style: const TextStyle(color: kMuted, fontSize: 12, fontWeight: FontWeight.w700),
                      ),
                      subtitle: Text(segment.text, style: const TextStyle(color: kText, height: 1.4)),
                    ),
                  )
                else
                  Text(_transcript!.text, style: const TextStyle(color: kText, height: 1.4)),
                const SizedBox(height: 22),
                const Text('AI Analysis', style: TextStyle(color: kText, fontSize: 18, fontWeight: FontWeight.w700)),
                const SizedBox(height: 10),
                if (_analysis == null)
                  const Text(
                    'Analyze with AI after transcription to generate a structured brief.',
                    style: TextStyle(color: kMuted),
                  )
                else ...[
                  Text(_analysis!.summary, style: const TextStyle(color: kText, height: 1.4)),
                  const SizedBox(height: 14),
                  const Text('Key topics', style: TextStyle(color: kMuted, fontWeight: FontWeight.w700)),
                  Text(
                    _analysis!.keyTopics.isEmpty ? 'None identified' : _analysis!.keyTopics.map((t) => '• $t').join('\n'),
                    style: const TextStyle(color: kText),
                  ),
                  const SizedBox(height: 14),
                  const Text('Decisions', style: TextStyle(color: kMuted, fontWeight: FontWeight.w700)),
                  Text(
                    _analysis!.decisions.isEmpty ? 'None identified' : _analysis!.decisions.map((t) => '• $t').join('\n'),
                    style: const TextStyle(color: kText),
                  ),
                  const SizedBox(height: 14),
                  const Text('Participants', style: TextStyle(color: kMuted, fontWeight: FontWeight.w700)),
                  Text(
                    _analysis!.participants.isEmpty ? 'Not specified' : _analysis!.participants.join(', '),
                    style: const TextStyle(color: kText),
                  ),
                ],
                const SizedBox(height: 22),
                const Text('Action items', style: TextStyle(color: kText, fontSize: 18, fontWeight: FontWeight.w700)),
                const SizedBox(height: 10),
                if (_items.isEmpty)
                  const Text('None identified', style: TextStyle(color: kMuted))
                else
                  ..._items.map(
                    (item) => Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: kCard,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: kBorder),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(item.task, style: const TextStyle(color: kText, fontWeight: FontWeight.w700)),
                          Text(
                            'Owner: ${item.displayOwner} · Due: ${item.displayDue}',
                            style: const TextStyle(color: kMuted),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              StatusBadge(text: item.priority, color: statusColor(item.priority)),
                              const SizedBox(width: 8),
                              StatusBadge(text: item.status.replaceAll('_', ' '), color: statusColor(item.status)),
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
