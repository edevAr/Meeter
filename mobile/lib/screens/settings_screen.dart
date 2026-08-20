import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _url;
  Meta? _meta;
  String _message = '';
  String _error = '';

  @override
  void initState() {
    super.initState();
    final api = context.read<ApiClient>();
    _url = TextEditingController(text: api.baseUrl);
    _refreshMeta();
  }

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _refreshMeta() async {
    try {
      final meta = await context.read<ApiClient>().getMeta();
      if (!mounted) return;
      setState(() {
        _meta = meta;
        _error = '';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    }
  }

  Future<void> _save() async {
    setState(() {
      _error = '';
      _message = '';
    });
    await context.read<ApiClient>().setBaseUrl(_url.text);
    setState(() => _message = 'API URL saved. The phone will talk to this backend.');
    await _refreshMeta();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text('Settings', style: TextStyle(color: kText, fontSize: 28, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        const Text(
          'The mobile app records on-device, then sends audio to your FastAPI backend for Whisper and AI analysis.',
          style: TextStyle(color: kMuted),
        ),
        const SizedBox(height: 20),
        const Text('API base URL', style: TextStyle(color: kText, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        TextField(
          controller: _url,
          autocorrect: false,
          style: const TextStyle(color: kText),
          decoration: const InputDecoration(hintText: defaultApiBase),
        ),
        const SizedBox(height: 8),
        const Text(
          'Physical phones must use the Mac LAN IP, not 127.0.0.1. Default: $defaultApiBase. Same Wi-Fi as the Mac. If the Mac IP changes, update lanHost in lib/api.dart.',
          style: TextStyle(color: kMuted, fontSize: 12),
        ),
        const SizedBox(height: 16),
        FilledButton(onPressed: _save, child: const Text('Save')),
        if (_message.isNotEmpty) Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Text(_message, style: const TextStyle(color: kSuccess)),
        ),
        if (_error.isNotEmpty) Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Text(_error, style: const TextStyle(color: kDanger)),
        ),
        if (_meta != null)
          Container(
            margin: const EdgeInsets.only(top: 24),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: kCard,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: kBorder),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Backend', style: TextStyle(color: kText, fontWeight: FontWeight.w700)),
                Text('Transcription: ${_meta!.transcriptionProvider}', style: const TextStyle(color: kMuted)),
                Text(
                  'Cloud STT: ${_meta!.transcriptionIsCloud ? (_meta!.allowCloudTranscription ? 'allowed' : 'blocked') : 'local'}',
                  style: const TextStyle(color: kMuted),
                ),
                Text('AI: ${_meta!.aiProvider} / ${_meta!.aiModel}', style: const TextStyle(color: kMuted)),
                Text('API key configured: ${_meta!.apiKeyConfigured ? 'yes' : 'no'}', style: const TextStyle(color: kMuted)),
                const SizedBox(height: 12),
                const Text(
                  'Audio is not uploaded to a cloud STT provider unless ALLOW_CLOUD_TRANSCRIPTION is enabled on the server. LLM analysis sends transcript text only, after you confirm in the app.',
                  style: TextStyle(color: kMuted, fontSize: 12),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
