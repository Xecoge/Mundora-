// Общие элементы интерфейса: стекло, пружинящие кнопки, меню-пузырёк, аватарки.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View, Text, StyleSheet, Modal, Dimensions, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { avaUri, gAvaUri, authed } from './api';

export const C = {
  bg: '#000', list: '#0d0819', card: 'rgba(255,255,255,.06)', line: 'rgba(255,255,255,.08)', text: '#fff', mute: '#8e8e93',
  blue: '#3e88f7', violet: '#8b5cf6', red: '#ff5b5b', green: '#34c759', me: '#2a6fe0', th: '#262629', sub: '#9c94bb', lav: '#b9b0d6', chat: '#0b1015',
};
export const GCOL = ['#e17076', '#f5a35b', '#9f86e8', '#6cc35a', '#4fc3c6', '#5aa7e6', '#ec74a8'];
export const UCOL = ['#ff8e86', '#ffc076', '#b9a3ff', '#8ee27a', '#6fdde0', '#7cc2ff', '#ff92c2'];
export const ucol = id => UCOL[Math.abs(+id || 0) % 7];
const isAndroid = Platform.OS === 'android';

export const tap = () => { Haptics.selectionAsync().catch(() => {}); };

// Кнопка-пузырёк (жидкое стекло iOS 26): при нажатии раздувается и чуть сплющивается,
// по стеклу пробегает блик, при отпускании — пружинит с покачиванием.
// pop=false — обычное «вдавливание» (для строк списков).
export function Press({ onPress, onLongPress, style, children, scale = 0.9, disabled, hitSlop = 6, delayLongPress = 320, pop = false, round = 22, amt = 0.13 }) {
  const sx = useRef(new Animated.Value(1)).current, sy = useRef(new Animated.Value(1)).current, gl = useRef(new Animated.Value(0)).current;
  const sp = (v, to, b) => Animated.spring(v, { toValue: to, useNativeDriver: true, speed: b ? 14 : 40, bounciness: b || 0 });
  const down = () => {
    if (pop) { Animated.parallel([sp(sx, 1 + amt), sp(sy, 1 + amt * 0.4), Animated.timing(gl, { toValue: 1, duration: 120, useNativeDriver: true })]).start(); tap(); }
    else Animated.parallel([sp(sx, scale), sp(sy, scale)]).start();
  };
  const up = () => Animated.parallel([sp(sx, 1, pop ? 18 : 12), sp(sy, 1, pop ? 16 : 12), Animated.timing(gl, { toValue: 0, duration: 380, useNativeDriver: true })]).start();
  return (
    <Pressable disabled={disabled} hitSlop={hitSlop} onPressIn={down} onPressOut={up} onPress={onPress} onLongPress={onLongPress} delayLongPress={delayLongPress}>
      <Animated.View style={[style, { transform: [{ scaleX: sx }, { scaleY: sy }] }, disabled && { opacity: 0.45 }]}>
        {children}
        {pop && <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: round, backgroundColor: 'rgba(255,255,255,.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,.35)', opacity: gl }]} />}
      </Animated.View>
    </Pressable>
  );
}

// Пузырь, который появляется с пружиной (для кнопок, которые возникают на экране)
export function PopIn({ children, delay = 0, style }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.spring(a, { toValue: 1, delay, useNativeDriver: true, speed: 12, bounciness: 12 }).start(); }, []);
  return <Animated.View style={[style, { opacity: a.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }), transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }]}>{children}</Animated.View>;
}

// Стеклянная подложка. На Android размытие дороже — даём его чуть слабее.
export function Glass({ style, children, intensity = 40, round = 22, tint = 'dark' }) {
  return (
    <View style={[{ borderRadius: round, overflow: 'hidden' }, style]}>
      <BlurView intensity={isAndroid ? Math.round(intensity * 0.8) : intensity} tint={tint} experimentalBlurMethod={isAndroid ? 'dimezisBlurView' : undefined} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(37,37,40,.62)', borderRadius: round, borderWidth: 1, borderColor: 'rgba(255,255,255,.09)' }]} />
      <View style={{ position: 'absolute', left: round * 0.6, right: round * 0.6, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,.12)' }} />
      {children}
    </View>
  );
}

export function GlassBtn({ icon, onPress, size = 48, color = '#fff', style, fill }) {
  return (
    <Press onPress={onPress} style={style} pop round={size / 2}>
      {fill ? (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={size * 0.5} color={color} />
        </View>
      ) : (
        <Glass round={size / 2} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={size * 0.5} color={color} />
        </Glass>
      )}
    </Press>
  );
}

export function Avatar({ p, size = 48 }) {
  return <Image source={authed(avaUri(p ? p.avatar : 'planet'))} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#222' }} cachePolicy="memory-disk" transition={150} />;
}
export function GAvatar({ g, size = 48, src }) {
  const u = src || gAvaUri(g);
  if (u) return <Image source={{ uri: u }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#222' }} cachePolicy="memory-disk" transition={150} />;
  const t = String((g && g.title) || '?').trim();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: GCOL[(g && g.col) || 0], alignItems: 'center', justifyContent: 'center' }}>
      {g && g.type === 'channel' && !t ? <Ionicons name="megaphone" size={size * 0.45} color="#fff" />
        : <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.42 }}>{([...t][0] || '?').toUpperCase()}</Text>}
    </View>
  );
}
export const Vf = ({ on, size = 16 }) => (on ? <Ionicons name="checkmark-circle" size={size} color={C.blue} style={{ marginLeft: 4 }} /> : null);

// Меню-пузырёк: выплывает из точки нажатия с пружиной, пункты появляются по очереди
let showMenu = null;
export function bubble(anchor, items) { if (showMenu) showMenu(anchor, items); tap(); }
export function BubbleHost() {
  const [st, setSt] = useState(null);
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    showMenu = (anchor, items) => { a.setValue(0); setSt({ anchor, items }); Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 9 }).start(); };
    return () => { showMenu = null; };
  }, []);
  if (!st) return null;
  const close = cb => Animated.timing(a, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => { setSt(null); cb && cb(); });
  const { width: W, height: H } = Dimensions.get('window');
  const w = 250, rows = st.items.filter(x => x !== '-').length, h = rows * 48 + st.items.filter(x => x === '-').length * 9 + 12;
  const ax = st.anchor ? st.anchor.x : W - 20, ay = st.anchor ? st.anchor.y : 80;
  const left = Math.max(10, Math.min(ax - (ax > W / 2 ? w - 24 : 24), W - w - 10));
  const top = ay + h + 20 > H ? Math.max(40, ay - h - 16) : ay + 16;
  const ox = ax - (left + w / 2), oy = ay - (top + h / 2);
  const sc = a.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] });
  const tx = a.interpolate({ inputRange: [0, 1], outputRange: [ox * 0.85, 0] });
  const ty = a.interpolate({ inputRange: [0, 1], outputRange: [oy * 0.85, 0] });
  return (
    <Modal transparent visible animationType="none" onRequestClose={() => close()} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => close()}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,.25)', opacity: a }]} />
      </Pressable>
      <Animated.View style={{ position: 'absolute', left, top, width: w, opacity: a.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }), transform: [{ translateX: tx }, { translateY: ty }, { scaleX: sc }, { scaleY: a.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.1, 1.06, 1] }) }] }}>
        <Glass round={24} intensity={60} style={{ paddingVertical: 6, backgroundColor: isAndroid ? 'rgba(40,40,46,.92)' : undefined }}>
          {st.items.map((it, k) => it === '-' ? <View key={k} style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.line, marginVertical: 4, marginHorizontal: 14 }} /> : (
            <Animated.View key={k} style={{ opacity: a.interpolate({ inputRange: [0, Math.min(0.9, 0.25 + k * 0.1), 1], outputRange: [0, 0, 1], extrapolate: 'clamp' }), transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [-8 - k * 2, 0] }) }] }}>
              <Pressable onPress={() => close(it.fn)} style={({ pressed }) => [{ height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginHorizontal: 6, borderRadius: 16 }, pressed && { backgroundColor: 'rgba(255,255,255,.12)', transform: [{ scale: 1.03 }] }]}>
                <Text style={{ flex: 1, color: it.red ? C.red : '#fff', fontSize: 16 }}>{it.t}</Text>
                {it.ic ? <Ionicons name={it.ic} size={21} color={it.red ? C.red : '#fff'} /> : null}
              </Pressable>
            </Animated.View>
          ))}
        </Glass>
      </Animated.View>
    </Modal>
  );
}

// Всплывающее уведомление
let showToast = null;
export function toast(t, bad) { if (showToast) showToast(t, bad); }
export function ToastHost() {
  const [st, setSt] = useState(null);
  const a = useRef(new Animated.Value(0)).current;
  const tm = useRef(null);
  useEffect(() => {
    showToast = (t, bad) => {
      setSt({ t, bad }); clearTimeout(tm.current);
      Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 10 }).start();
      tm.current = setTimeout(() => Animated.timing(a, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setSt(null)), 2400);
    };
    return () => { showToast = null; };
  }, []);
  if (!st) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 54, alignSelf: 'center', opacity: a, transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }}>
      <Glass round={20} style={{ paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' }}>
        <Ionicons name={st.bad ? 'alert-circle' : 'checkmark-circle'} size={18} color={st.bad ? C.red : C.green} />
        <Text style={{ color: '#fff', marginLeft: 8, fontSize: 15 }}>{st.t}</Text>
      </Glass>
    </Animated.View>
  );
}

export const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
export const gN = (g, n) => { n = n ?? (g && g.n) ?? 0; return g && g.type === 'channel' ? n + ' ' + plural(n, 'подписчик', 'подписчика', 'подписчиков') : n + ' ' + plural(n, 'участник', 'участника', 'участников'); };
const pad = x => String(x).padStart(2, '0');
export const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
export function when(t) {
  if (!t) return '';
  const d = new Date(t), n = new Date();
  if (d.toDateString() === n.toDateString()) return hm(t);
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'вчера';
  if (n - d < 6 * 864e5) return ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()];
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + (d.getFullYear() !== n.getFullYear() ? '.' + String(d.getFullYear()).slice(2) : '');
}
export function dayLabel(t) {
  const d = new Date(t), n = new Date();
  if (d.toDateString() === n.toDateString()) return 'Сегодня';
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}) });
}
export function seen(p, on) {
  if (!p) return '';
  if (on || p.online) return 'в сети';
  if (!p.seen) return 'был(а) давно';
  return 'был(а) ' + (Date.now() - p.seen < 864e5 ? 'в ' + hm(p.seen) : when(p.seen));
}
export const pvNice = s => String(s || '').replace(/\s+/g, ' ');

// фон чата с сайта: тёмный + узор из иконок (тот же SVG, прозрачность 5.5%)
import { SvgXml } from 'react-native-svg';
const WALL = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><defs><pattern id="p" width="220" height="220" patternUnits="userSpaceOnUse"><g fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M24 30l6 12 13 2-9 9 2 13-12-6-12 6 2-13-9-9 13-2z"/><circle cx="160" cy="40" r="13"/><path d="M147 40c-6-6 32-6 26 0"/><path d="M90 90c0-8 12-8 12 0 0-8 12-8 12 0 0 9-12 15-12 15s-12-6-12-15z"/><path d="M30 150v-26l22-5v26"/><circle cx="25" cy="151" r="5"/><circle cx="47" cy="146" r="5"/><rect x="140" y="120" width="34" height="24" rx="5"/><path d="M140 126l17 10 17-10"/><path d="M95 175l18-14 5 22-8-6z"/><circle cx="190" cy="190" r="4"/><circle cx="70" cy="205" r="3"/><path d="M185 85a10 10 0 1 1-10-10 8 8 0 0 0 10 10z"/></g></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`;
export function Wallpaper() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: C.chat }]} />
      <SvgXml xml={WALL} width="100%" height="100%" opacity={0.055} />
    </View>
  );
}
// фон списка/профиля с сайта: #0d0819 + фиолетовые свечения по углам
import { LinearGradient as LG } from 'expo-linear-gradient';
export function ListBg() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0d0819' }]} />
      <LG colors={['rgba(124,58,237,.28)', 'rgba(124,58,237,0)']} start={{ x: 0, y: 0 }} end={{ x: 0.55, y: 0.4 }} style={StyleSheet.absoluteFill} />
      <LG colors={['rgba(168,85,247,0)', 'rgba(168,85,247,.18)']} start={{ x: 0.45, y: 0.6 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
    </View>
  );
}
