import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import '../api.dart';
import '../prefs.dart';
import '../theme.dart';
import '../widgets.dart';

enum _AuthView { login, register, forgot, reset }

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  _AuthView _view = _AuthView.login;
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  final _code = TextEditingController();
  String _error = '';
  String _notice = '';
  String? _resetCode;
  bool _busy = false;
  bool _showPassword = false;
  bool _showConfirm = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _confirm.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _error = '';
      _notice = '';
      _busy = true;
    });
    final api = context.read<ApiClient>();
    try {
      switch (_view) {
        case _AuthView.login:
          await api.login(_email.text.trim(), _password.text);
        case _AuthView.register:
          if (_password.text != _confirm.text) {
            throw ApiException('Las claves no coinciden.');
          }
          await api.register(email: _email.text.trim(), password: _password.text, name: _name.text.trim());
        case _AuthView.forgot:
          final code = await api.forgotPassword(_email.text.trim());
          _resetCode = code;
          _notice = 'Si el correo existe, te dimos un código.';
          _view = _AuthView.reset;
        case _AuthView.reset:
          await api.resetPassword(email: _email.text.trim(), code: _code.text.trim(), password: _password.text);
          _notice = 'Clave actualizada. Ya puedes entrar.';
          _view = _AuthView.login;
      }
    } catch (error) {
      _error = error.toString();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final prefs = context.watch<PrefsController>();
    final wide = isTablet(context);
    return CorkBackdrop(
      child: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: wide ? 520 : 420),
            child: ListView(
              padding: EdgeInsets.symmetric(horizontal: wide ? 36 : 20, vertical: 28),
              children: [
                Text('MEETER', style: GoogleFonts.nunito(color: kSun, letterSpacing: 4, fontWeight: FontWeight.w800, fontSize: 12)),
                const SizedBox(height: 8),
                Text(prefs.t('login.headline'), style: GoogleFonts.caveat(color: headerOnCork(context), fontSize: wide ? 48 : 38, height: 0.95)),
                const SizedBox(height: 8),
                Text(
                  prefs.t('login.lede'),
                  style: TextStyle(color: headerOnCork(context).withValues(alpha: 0.78), fontSize: 15),
                ),
                const SizedBox(height: 28),
                PaperCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(child: Container(width: 64, height: 10, decoration: BoxDecoration(color: const Color(0x66C23B22), borderRadius: BorderRadius.circular(4)))),
                      const SizedBox(height: 16),
                      Text(_kicker, style: GoogleFonts.nunito(color: kMuted, fontSize: 11, letterSpacing: 1.6, fontWeight: FontWeight.w800)),
                      Text(_title, style: GoogleFonts.caveat(fontSize: 32, color: kInk)),
                      const SizedBox(height: 16),
                      if (_view == _AuthView.register)
                        _field('Nombre', _name, hint: 'Ana'),
                      _field('Correo', _email, hint: 'tu@correo.com', keyboard: TextInputType.emailAddress),
                      if (_view == _AuthView.login || _view == _AuthView.register || _view == _AuthView.reset)
                        _field(
                          'Clave',
                          _password,
                          hint: 'Mínimo 8 caracteres',
                          secret: true,
                          revealed: _showPassword,
                          onToggle: () => setState(() => _showPassword = !_showPassword),
                        ),
                      if (_view == _AuthView.register)
                        _field(
                          'Repite la clave',
                          _confirm,
                          secret: true,
                          revealed: _showConfirm,
                          onToggle: () => setState(() => _showConfirm = !_showConfirm),
                        ),
                      if (_view == _AuthView.reset) ...[
                        if (_resetCode != null)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Text('Tu código es $_resetCode. Caduca en 30 minutos.', style: const TextStyle(color: kMint, fontWeight: FontWeight.w700)),
                          ),
                        _field('Código', _code, hint: '000000', keyboard: TextInputType.number),
                      ],
                      if (_error.isNotEmpty) Text(_error, style: const TextStyle(color: kDanger, fontWeight: FontWeight.w700)),
                      if (_notice.isNotEmpty) Text(_notice, style: const TextStyle(color: kMint, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: _busy ? null : _submit,
                        child: Text(_busy ? 'Un segundo…' : _action),
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        alignment: WrapAlignment.center,
                        spacing: 12,
                        children: [
                          if (_view != _AuthView.login)
                            TextButton(
                              onPressed: () => setState(() {
                                _view = _AuthView.login;
                                _showPassword = false;
                                _showConfirm = false;
                              }),
                              child: const Text('Entrar'),
                            ),
                          if (_view != _AuthView.register)
                            TextButton(
                              onPressed: () => setState(() {
                                _view = _AuthView.register;
                                _showPassword = false;
                                _showConfirm = false;
                              }),
                              child: const Text('Crear cuenta'),
                            ),
                          if (_view != _AuthView.forgot && _view != _AuthView.reset)
                            TextButton(onPressed: () => setState(() => _view = _AuthView.forgot), child: const Text('Olvidé la clave')),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String get _kicker => switch (_view) {
        _AuthView.login => 'Bienvenida',
        _AuthView.register => 'Nueva cuenta',
        _AuthView.forgot => 'Recuperar',
        _AuthView.reset => 'Nueva clave',
      };

  String get _title => switch (_view) {
        _AuthView.login => 'Entra a tu corcho',
        _AuthView.register => 'Crea tu cuenta',
        _AuthView.forgot => 'Te enviamos un código',
        _AuthView.reset => 'Cambia la clave',
      };

  String get _action => switch (_view) {
        _AuthView.login => 'Entrar',
        _AuthView.register => 'Crear cuenta',
        _AuthView.forgot => 'Pedir código',
        _AuthView.reset => 'Guardar clave',
      };

  Widget _field(
    String label,
    TextEditingController controller, {
    String? hint,
    bool secret = false,
    bool revealed = false,
    VoidCallback? onToggle,
    TextInputType? keyboard,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: kMuted, fontWeight: FontWeight.w800, fontSize: 12)),
          const SizedBox(height: 4),
          TextField(
            controller: controller,
            obscureText: secret && !revealed,
            keyboardType: keyboard,
            decoration: InputDecoration(
              hintText: hint,
              suffixIcon: secret
                  ? IconButton(
                      onPressed: onToggle,
                      tooltip: revealed ? 'Ocultar clave' : 'Mostrar clave',
                      icon: Icon(revealed ? Icons.visibility_outlined : Icons.visibility_off_outlined, color: kMuted),
                    )
                  : null,
            ),
          ),
        ],
      ),
    );
  }
}
