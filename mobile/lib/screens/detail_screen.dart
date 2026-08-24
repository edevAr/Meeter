import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';

class DetailScreen extends StatefulWidget {
  const DetailScreen({super.key, required this.recordingId, this.autostart, this.embedded = false});

  final String recordingId;
  final String? autostart;
  final bool embedded;

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
      _busy = 'Transcribiendo…';
      _error = '';
    });
    try {
      await _api.transcribe(widget.recordingId);
      await _load();
      if (!mounted) return;
      final go = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          backgroundColor: kPaper,
          title: const Text('Transcripción lista'),
          content: const Text('¿La analizamos con IA?'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Después')),
            TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Analizar')),
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
    setState(() {
      _busy = 'Analizando…';
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
        backgroundColor: kPaper,
        title: const Text('Eliminar llamada'),
        content: const Text('Se borra el audio, la transcripción y el análisis.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Eliminar')),
        ],
      ),
    );
    if (ok != true) return;
    await _api.deleteRecording(widget.recordingId);
    if (mounted && !widget.embedded) Navigator.pop(context);
  }

  Future<void> _export(String kind, String format) async {
    final uri = Uri.parse(_api.exportUrl(widget.recordingId, kind, format));
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      setState(() => _error = 'No se pudo abrir la exportación. Revisa la URL del API.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final recording = _recording;
    final content = recording == null
        ? Center(
            child: _error.isEmpty
                ? const CircularProgressIndicator(color: kSun)
                : Text(_error, style: const TextStyle(color: kDanger)),
          )
        : ListView(
            padding: widget.embedded ? const EdgeInsets.all(16) : const EdgeInsets.fromLTRB(16, 8, 16, 28),
            children: [
              PaperCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(recording.title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                    Text('${formatDate(recording.createdAt)} · ${formatDuration(recording.durationSeconds)}', style: const TextStyle(color: kMuted)),
                    const SizedBox(height: 8),
                    StatusChip(label: statusLabel(recording.status), color: statusColor(recording.status)),
                    const SizedBox(height: 12),
                    StreamBuilder<Duration>(
                      stream: _player.positionStream,
                      builder: (context, snapshot) {
                        final position = snapshot.data ?? Duration.zero;
                        final duration = _player.duration ?? Duration.zero;
                        return FilledButton(
                          onPressed: _togglePlay,
                          child: Text('${_player.playing ? 'Pausar' : 'Escuchar'}  ${formatClock(position)} / ${formatClock(duration)}'),
                        );
                      },
                    ),
                    if (_error.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error, style: const TextStyle(color: kDanger))),
                    if (_busy.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_busy, style: const TextStyle(color: kMuted))),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        FilledButton(onPressed: _busy.isEmpty ? _transcribe : null, child: const Text('Transcribir')),
                        FilledButton(onPressed: _busy.isEmpty ? _analyze : null, child: const Text('Analizar')),
                        OutlinedButton(onPressed: () => _export('transcript', 'md'), child: const Text('Exportar texto')),
                        OutlinedButton(onPressed: () => _export('analysis', 'md'), child: const Text('Exportar IA')),
                        TextButton(onPressed: _delete, child: const Text('Eliminar', style: TextStyle(color: kDanger))),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              PaperCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Transcripción', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                    const SizedBox(height: 8),
                    if (_transcript == null)
                      const Text('Aún no hay texto. Toca Transcribir.', style: TextStyle(color: kMuted))
                    else if (_transcript!.segments.isNotEmpty)
                      ..._transcript!.segments.map(
                        (segment) => ListTile(
                          contentPadding: EdgeInsets.zero,
                          onTap: () => _seekTo(segment.startTime),
                          title: Text(
                            '${segment.speaker ?? 'Voz'} · ${formatClock(Duration(milliseconds: (segment.startTime * 1000).round()))}',
                            style: const TextStyle(color: kMuted, fontSize: 12, fontWeight: FontWeight.w700),
                          ),
                          subtitle: Text(segment.text),
                        ),
                      )
                    else
                      Text(_transcript!.text),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              PaperCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Análisis', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                    const SizedBox(height: 8),
                    if (_analysis == null)
                      const Text('Analiza la transcripción para sacar resumen, temas y decisiones.', style: TextStyle(color: kMuted))
                    else ...[
                      Text(_analysis!.summary),
                      const SizedBox(height: 10),
                      const Text('Temas', style: TextStyle(color: kMuted, fontWeight: FontWeight.w800)),
                      Text(_analysis!.keyTopics.isEmpty ? 'Ninguno' : _analysis!.keyTopics.map((t) => '• $t').join('\n')),
                      const SizedBox(height: 10),
                      const Text('Decisiones', style: TextStyle(color: kMuted, fontWeight: FontWeight.w800)),
                      Text(_analysis!.decisions.isEmpty ? 'Ninguna' : _analysis!.decisions.map((t) => '• $t').join('\n')),
                    ],
                    const SizedBox(height: 12),
                    const Text('Pendientes de la llamada', style: TextStyle(fontWeight: FontWeight.w800)),
                    if (_items.isEmpty)
                      const Text('Ninguno', style: TextStyle(color: kMuted))
                    else
                      ..._items.map((item) => ListTile(contentPadding: EdgeInsets.zero, title: Text(item.task), subtitle: Text(item.owner ?? 'Sin dueño'))),
                  ],
                ),
              ),
            ],
          );

    if (widget.embedded) {
      return PaperCard(padding: EdgeInsets.zero, child: ClipRRect(borderRadius: BorderRadius.circular(18), child: content));
    }
    return Scaffold(
      backgroundColor: kCork,
      appBar: AppBar(title: const Text('Llamada')),
      body: CorkBackdrop(child: content),
    );
  }
}
