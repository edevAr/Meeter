import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'api.dart';
import 'note_store.dart';
import 'prefs.dart';
import 'screens/board_screen.dart';
import 'screens/login_screen.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final api = ApiClient();
  final prefs = PrefsController();
  await Future.wait([api.load(), prefs.load()]);
  final notes = NoteStore(api);
  await notes.start();
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: api),
        ChangeNotifierProvider.value(value: prefs),
        ChangeNotifierProvider.value(value: notes),
      ],
      child: const MeeterApp(),
    ),
  );
}

class MeeterApp extends StatelessWidget {
  const MeeterApp({super.key});

  @override
  Widget build(BuildContext context) {
    final prefs = context.watch<PrefsController>();
    return MaterialApp(
      title: 'Meeter',
      debugShowCheckedModeBanner: false,
      locale: prefs.locale,
      theme: buildAppTheme(brightness: Brightness.light),
      darkTheme: buildAppTheme(),
      themeMode: prefs.themeMode,
      home: const RootGate(),
    );
  }
}

class RootGate extends StatelessWidget {
  const RootGate({super.key});

  @override
  Widget build(BuildContext context) {
    final api = context.watch<ApiClient>();
    if (!api.ready) {
      return const Scaffold(body: Center(child: CircularProgressIndicator(color: kSun)));
    }
    if (!api.isLoggedIn) return const LoginScreen();
    return const BoardScreen();
  }
}
