// Вход тем же аккаунтом Mundora: почта + пароль → код из письма. Регистрация — по коду доступа.
import React, { useRef, useState, useEffect } from 'react';
import { View, Text, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Animated, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth } from '../api';
import { C, Glass, Press, toast } from '../ui';

export default function Login({ onDone }) {
  const ins = useSafeAreaInsets();
  const [mode, setMode] = useState('login'); // login | reg
  const [step, setStep] = useState('form'); // gate | form | code
  const [f, setF] = useState({ email: '', password: '', name: '', code: '', gate: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { a.setValue(0); Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 8 }).start(); }, [step, mode]);
  const up = k => v => setF(o => ({ ...o, [k]: v }));

  async function go() {
    setErr(''); setBusy(true);
    try {
      if (step === 'gate') { await auth('gate', { code: f.gate }); setStep('form'); }
      else if (step === 'form') {
        if (mode === 'reg') await auth('register', { email: f.email, password: f.password, name: f.name });
        else await auth('login', { email: f.email, password: f.password });
        setStep('code'); toast('Код отправлен на почту');
      } else {
        await auth('verify', { email: f.email, code: f.code });
        await onDone();
      }
    } catch (e) {
      if (e.data && e.data.needGate) { setStep('gate'); setErr('Для регистрации нужен код доступа'); }
      else if (e.data && e.data.missing) { setMode('reg'); setErr('Аккаунта нет — создай его'); }
      else setErr(e.message);
    }
    setBusy(false);
  }

  const inp = (k, ph, o = {}) => (
    <TextInput value={f[k]} onChangeText={up(k)} placeholder={ph} placeholderTextColor="#77708f" autoCapitalize="none" autoCorrect={false}
      style={{ color: '#fff', fontSize: 17, paddingHorizontal: 16, height: 54 }} selectionColor={C.violet} {...o} />
  );
  const sep = <View style={{ height: 1, backgroundColor: C.line, marginLeft: 16 }} />;

  return (
    <LinearGradient colors={['#1a0b3a', '#0d0819', '#000']} style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 22, paddingTop: ins.top + 30 }} keyboardShouldPersistTaps="handled">
          <Animated.View style={{ opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }, { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}>
            <Text style={{ color: '#fff', fontSize: 40, fontWeight: '800', textAlign: 'center', letterSpacing: -1 }}>Mundere</Text>
            <Text style={{ color: C.mute, fontSize: 15, textAlign: 'center', marginTop: 6, marginBottom: 30 }}>
              {step === 'gate' ? 'Введи код доступа, чтобы создать аккаунт' : step === 'code' ? 'Введи 6 цифр из письма на ' + f.email : mode === 'reg' ? 'Новый аккаунт' : 'Войди аккаунтом Mundora'}
            </Text>
            <Glass round={20}>
              {step === 'gate' ? inp('gate', 'Код доступа (4 символа)', { maxLength: 4, autoCapitalize: 'characters' })
                : step === 'code' ? inp('code', '000000', { keyboardType: 'number-pad', maxLength: 6, textAlign: 'center', style: { color: '#fff', fontSize: 28, letterSpacing: 10, height: 64 } })
                : (<>
                  {mode === 'reg' && <>{inp('name', 'Имя')}{sep}</>}
                  {inp('email', 'Почта', { keyboardType: 'email-address', textContentType: 'emailAddress' })}{sep}
                  {inp('password', 'Пароль', { secureTextEntry: true, textContentType: 'password', onSubmitEditing: go })}
                </>)}
            </Glass>
            {!!err && <Text style={{ color: C.red, marginTop: 12, textAlign: 'center' }}>{err}</Text>}
            <Press onPress={go} disabled={busy} style={{ marginTop: 20 }}>
              <LinearGradient colors={['#8b5cf6', '#6d28d9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' }}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>{step === 'code' ? 'Подтвердить' : step === 'gate' ? 'Дальше' : mode === 'reg' ? 'Создать аккаунт' : 'Войти'}</Text>}
              </LinearGradient>
            </Press>
            {step !== 'code' ? (
              <Press onPress={() => { setErr(''); setStep('form'); setMode(mode === 'reg' ? 'login' : 'reg'); }} style={{ marginTop: 18, alignSelf: 'center' }}>
                <Text style={{ color: '#b9a3ff', fontSize: 15 }}>{mode === 'reg' ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Создать'}</Text>
              </Press>
            ) : (
              <Press onPress={() => { setStep('form'); setF(o => ({ ...o, code: '' })); }} style={{ marginTop: 18, alignSelf: 'center' }}>
                <Text style={{ color: '#b9a3ff', fontSize: 15 }}>Назад</Text>
              </Press>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
