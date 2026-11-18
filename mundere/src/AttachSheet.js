// Скрепка — как на сайте: шторка «Недавние / Файлы / Геопозиция / Контакты / Музыка»,
// внизу стеклянная панель вкладок, сетка фото и видео из галереи телефона с выбором по кружку.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, Animated, Dimensions, FlatList, TextInput, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { S, isG } from './store';
import { M, BASE } from './api';
import { C, Glass, Press, Avatar, toast, tap } from './ui';

const TABS = [['gal', 'Галерея', '#3e88f7', 'image'], ['file', 'Файл', '#3e88f7', 'document'], ['geo', 'Геопозиция', '#30a46c', 'location'], ['contact', 'Контакт', '#f5a524', 'person-circle'], ['music', 'Музыка', '#e93d82', 'musical-notes']];
const TITLE = { gal: 'Недавние', file: 'Файлы', geo: 'Геопозиция', contact: 'Контакты', music: 'Музыка' };

export default function AttachSheet({ onClose, onCamera, onPickMedia, onPickFile, onPickRaw, onPickAudio, onSendAssets, onOpenAsset, onSendText, onForward, chatId }) {
  const ins = useSafeAreaInsets();
  const { width: SW, height: SH } = Dimensions.get('window');
  const a = useRef(new Animated.Value(0)).current;
  const [tab, setTab] = useState('gal');
  const [sel, setSel] = useState([]);
  const [cap, setCap] = useState('');
  useEffect(() => { Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6 }).start(); }, []);
  const close = cb => Animated.timing(a, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => { onClose(); cb && cb(); });
  const H = SH * 0.74;
  const tw = (SW - 24 - 10) / 5;
  const tx = useRef(new Animated.Value(0)).current;
  const go = (t, i) => { tap(); setTab(t); Animated.spring(tx, { toValue: i * tw, useNativeDriver: true, speed: 14, bounciness: 10 }).start(); };
  const cur = TABS.find(x => x[0] === tab);

  return (
    <Modal transparent visible animationType="none" onRequestClose={() => close()} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => close()}><Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,.45)', opacity: a }]} /></Pressable>
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: H, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [H, 0] }) }] }}>
        <View style={st.panel}>
          <View style={st.grab} />
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 52 }}>
            <Press onPress={() => close()} pop round={20}><Glass round={20} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={20} color="#fff" /></Glass></Press>
            <Text style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: '700', marginRight: 40 }}>{TITLE[tab]}</Text>
          </View>
          <View style={{ flex: 1 }}>
            {tab === 'gal' && <Gallery sel={sel} setSel={setSel} onCamera={() => close(onCamera)} onPick={() => close(onPickMedia)} onOpen={as => close(() => onOpenAsset(as))} />}
            {tab === 'file' && (
              <View style={{ paddingHorizontal: 12 }}>
                <View style={st.grp}>
                  <Row ic="document" c="#3e88f7" t="Выбрать файл" s="Любой файл до 12 МБ" onPress={() => close(onPickFile)} />
                  <View style={st.sep} />
                  <Row ic="grid" c="#3e88f7" t="Фото или видео без сжатия" s="Отправить как файл в исходном качестве" onPress={() => close(onPickRaw)} />
                </View>
              </View>
            )}
            {tab === 'geo' && <Geo onSend={t => close(() => onSendText(t))} />}
            {tab === 'contact' && <Contacts onSend={t => close(() => onSendText(t))} />}
            {tab === 'music' && (
              <View style={{ paddingHorizontal: 12, flex: 1 }}>
                <View style={st.grp}><Row ic="musical-note" c="#e93d82" t="Выбрать аудиофайл" s="MP3, M4A, WAV, OGG" onPress={() => close(onPickAudio)} /></View>
                <RecentMusic chatId={chatId} onSend={m => close(() => onForward(m))} />
              </View>
            )}
          </View>
          {tab === 'gal' && sel.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: ins.bottom + 10, paddingTop: 8 }}>
              <Glass round={24} style={{ flex: 1, height: 48, justifyContent: 'center', paddingHorizontal: 16, marginRight: 8 }}>
                <TextInput value={cap} onChangeText={setCap} placeholder="Добавить подпись…" placeholderTextColor="#8e8e93" style={{ color: '#fff', fontSize: 16 }} />
              </Glass>
              <Press pop round={24} onPress={() => { const s2 = sel.slice(); close(() => onSendAssets(s2, cap.trim())); }}>
                <View style={{ height: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: 24, backgroundColor: C.blue, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="arrow-up" size={22} color="#fff" /><Text style={{ color: '#fff', fontWeight: '800', fontSize: 15, marginLeft: 4 }}>{sel.length}</Text>
                </View>
              </Press>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 12, paddingBottom: ins.bottom + 10, paddingTop: 6 }}>
              <Glass round={32} intensity={50} style={{ height: 62, flexDirection: 'row', padding: 5 }}>
                <Animated.View style={{ position: 'absolute', left: 5, top: 5, width: tw, height: 52, borderRadius: 26, backgroundColor: cur[2] + '33', borderTopWidth: 1, borderColor: 'rgba(255,255,255,.3)', transform: [{ translateX: tx }] }} />
                {TABS.map(([k, t, col, ic], i) => (
                  <Press key={k} onPress={() => go(k, i)} pop round={26} amt={0.1} style={{ width: tw, height: 52, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={ic} size={22} color={tab === k ? col : '#fff'} />
                    <Text style={{ color: tab === k ? col : '#fff', fontSize: 11, fontWeight: '600', marginTop: 2 }}>{t}</Text>
                  </Press>
                ))}
              </Glass>
            </View>
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

function Row({ ic, c, t, s, onPress }) {
  return (
    <Press onPress={onPress} pop round={16} amt={0.03} style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={ic} size={20} color="#fff" /></View>
      <View style={{ marginLeft: 12, flex: 1 }}><Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{t}</Text><Text style={{ color: '#9a9aa2', fontSize: 13 }}>{s}</Text></View>
    </Press>
  );
}

// сетка галереи телефона: камера, «Выбрать», потом последние фото и видео
function Gallery({ sel, setSel, onCamera, onPick, onOpen }) {
  const [perm, setPerm] = useState(null);
  const [items, setItems] = useState([]);
  const [end, setEnd] = useState(null);
  const W = (Dimensions.get('window').width - 8) / 3;
  async function load(after) {
    try {
      const r = await MediaLibrary.getAssetsAsync({ first: 60, after, mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video], sortBy: [[MediaLibrary.SortBy.creationTime, false]] });
      setItems(L => (after ? [...L, ...r.assets] : r.assets)); setEnd(r.hasNextPage ? r.endCursor : null);
    } catch (e) {}
  }
  useEffect(() => { (async () => { const p = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']); setPerm(p); if (p.granted) load(); })(); }, []);
  const ask = async () => { const p = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']); setPerm(p); if (p.granted) load(); else if (!p.canAskAgain) Linking.openSettings(); };
  const data = [{ id: '_cam' }, { id: '_pick' }, ...items];
  if (perm && !perm.granted) return (
    <View style={{ flex: 1, alignItems: 'center', paddingTop: 30, paddingHorizontal: 30 }}>
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 18 }}>
        <Press onPress={onCamera} pop round={14}><View style={[st.tile, { width: W, height: W }]}><Ionicons name="radio-button-on" size={34} color="#fff" /></View></Press>
        <Press onPress={onPick} pop round={14}><View style={[st.tile, { width: W, height: W }]}><Ionicons name="grid" size={26} color={C.blue} /><Text style={st.tb}>Выбрать</Text><Text style={st.ts}>Фото и видео</Text></View></Press>
      </View>
      <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' }}>Предоставьте доступ к Фото и видео, чтобы пользоваться этим</Text>
      <Press onPress={ask} pop round={22} style={{ marginTop: 16 }}><View style={st.blueBtn}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Предоставить доступ</Text></View></Press>
    </View>
  );
  return (
    <FlatList data={data} numColumns={3} keyExtractor={x => x.id} contentContainerStyle={{ paddingHorizontal: 2 }} onEndReached={() => end && load(end)} onEndReachedThreshold={0.5}
      initialNumToRender={18} windowSize={7} removeClippedSubviews
      renderItem={({ item }) => {
        if (item.id === '_cam') return <Press onPress={onCamera} pop round={4} amt={0.04} style={{ margin: 1 }}><View style={[st.tile, { width: W, height: W }]}><View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,.5)', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="radio-button-on" size={28} color="#fff" /></View></View></Press>;
        if (item.id === '_pick') return <Press onPress={onPick} pop round={4} amt={0.04} style={{ margin: 1 }}><View style={[st.tile, { width: W, height: W }]}><Ionicons name="grid" size={26} color={C.blue} /><Text style={st.tb}>Выбрать</Text><Text style={st.ts}>Фото и видео</Text></View></Press>;
        const n = sel.findIndex(x => x.id === item.id);
        const toggle = () => { tap(); setSel(L => (n >= 0 ? L.filter(x => x.id !== item.id) : L.length < 10 ? [...L, item] : L)); };
        return (
          <Pressable onPress={() => (sel.length ? toggle() : onOpen(item))} style={{ margin: 1 }}>
            <Image source={{ uri: item.uri }} style={{ width: W, height: W, backgroundColor: '#222' }} contentFit="cover" recyclingKey={item.id} transition={120} />
            {item.mediaType === 'video' && <View style={st.dur}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{Math.floor(item.duration / 60)}:{String(Math.round(item.duration % 60)).padStart(2, '0')}</Text></View>}
            {n >= 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,.25)' }]} />}
            <Pressable onPress={toggle} hitSlop={8} style={[st.ck, n >= 0 && { backgroundColor: C.blue, borderColor: '#fff' }]}>{n >= 0 && <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>{n + 1}</Text>}</Pressable>
          </Pressable>
        );
      }} />
  );
}

// геопозиция: карта (тайлы OpenStreetMap), отправка ссылкой — как на сайте
function Geo({ onSend }) {
  const [perm, setPerm] = useState(null);
  const [pos, setPos] = useState(null);
  const W = Dimensions.get('window').width - 24;
  useEffect(() => { Location.getForegroundPermissionsAsync().then(p => { setPerm(p); if (p.granted) locate(); }).catch(() => setPerm({ granted: false })); }, []);
  async function locate() {
    try {
      const last = await Location.getLastKnownPositionAsync(); if (last) setPos(last.coords);
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }); setPos(p.coords);
    } catch (e) { toast('Не удалось определить место', 1); }
  }
  const ask = async () => { const p = await Location.requestForegroundPermissionsAsync(); setPerm(p); if (p.granted) locate(); else if (!p.canAskAgain) Linking.openSettings(); };
  if (perm && !perm.granted) return (
    <View style={{ alignItems: 'center', paddingTop: 20, paddingHorizontal: 30 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(48,164,108,.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,.15)', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="location" size={34} color="#30a46c" /></View>
      <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', marginTop: 18 }}>Предоставьте доступ к геопозиции, чтобы пользоваться этим</Text>
      <Press onPress={ask} pop round={22} style={{ marginTop: 16 }}><View style={st.blueBtn}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Предоставить доступ</Text></View></Press>
    </View>
  );
  if (!pos) return <View style={{ alignItems: 'center', paddingTop: 40 }}><ActivityIndicator color="#30a46c" /><Text style={{ color: '#9a9aa2', marginTop: 10 }}>Определяю место…</Text></View>;
  const la = pos.latitude.toFixed(6), lo = pos.longitude.toFixed(6);
  return (
    <View style={{ paddingHorizontal: 12 }}>
      <MapTiles lat={pos.latitude} lon={pos.longitude} w={W} h={W * 0.62} />
      <Text style={{ color: '#9a9aa2', fontSize: 13, marginTop: 8, textAlign: 'center' }}>точность ≈ {Math.round(pos.accuracy || 0)} м</Text>
      <Press onPress={() => onSend(`📍 Геопозиция\nhttps://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=16/${la}/${lo}`)} pop round={16} amt={0.03} style={{ marginTop: 10 }}>
        <View style={[st.grp, { flexDirection: 'row', alignItems: 'center', padding: 12 }]}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#30a46c', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="navigate" size={20} color="#fff" /></View>
          <View style={{ marginLeft: 12 }}><Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Отправить мою геопозицию</Text><Text style={{ color: '#9a9aa2', fontSize: 13 }}>{la}, {lo}</Text></View>
        </View>
      </Press>
    </View>
  );
}
export function MapTiles({ lat, lon, w, h, z = 16, round = 18 }) {
  const n = 2 ** z, xt = ((lon + 180) / 360) * n, yt = ((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2) * n;
  const T = 256, cx = w / 2, cy = h / 2, x0 = Math.floor(xt), y0 = Math.floor(yt), fx = (xt - x0) * T, fy = (yt - y0) * T;
  const tiles = [];
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
    const left = cx - fx + dx * T, top = cy - fy + dy * T;
    if (left > w || top > h || left + T < 0 || top + T < 0) continue;
    tiles.push(<Image key={dx + '_' + dy} source={{ uri: `https://tile.openstreetmap.org/${z}/${x0 + dx}/${y0 + dy}.png`, headers: { 'User-Agent': 'Mundere/1.0 (mundorai.vercel.app)' } }} style={{ position: 'absolute', left, top, width: T, height: T }} cachePolicy="disk" />);
  }
  return (
    <View style={{ width: w, height: h, borderRadius: round, overflow: 'hidden', backgroundColor: '#1d2a22' }}>
      {tiles}
      <View style={{ position: 'absolute', left: cx - 16, top: cy - 36 }}><Ionicons name="location" size={34} color="#e5484d" /></View>
    </View>
  );
}

function Contacts({ onSend }) {
  const [q, setQ] = useState('');
  const ids = [...new Set(S.chats.filter(c => c.p != null && String(c.p) !== String(M.me)).map(c => String(c.p)))];
  const L = ids.map(id => S.peers[id]).filter(Boolean).filter(p => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()) || String(p.id) === q.trim());
  return (
    <View style={{ flex: 1, paddingHorizontal: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,.08)', paddingHorizontal: 12, marginBottom: 8 }}>
        <Ionicons name="search" size={16} color="#9a9aa2" /><TextInput value={q} onChangeText={setQ} placeholder="Поиск контактов" placeholderTextColor="#9a9aa2" style={{ flex: 1, color: '#fff', marginLeft: 8, fontSize: 15, paddingVertical: 0 }} />
      </View>
      <FlatList data={L} keyExtractor={p => String(p.id)} ListEmptyComponent={<Text style={{ color: '#9a9aa2', textAlign: 'center', marginTop: 30 }}>Контактов нет</Text>}
        renderItem={({ item: p }) => (
          <Press onPress={() => onSend(`👤 ${(p.name || 'Контакт').replace(/\n/g, ' ')}\n${BASE}/#msgp-${p.id}`)} pop round={16} amt={0.03} style={{ marginBottom: 6 }}>
            <View style={[st.grp, { flexDirection: 'row', alignItems: 'center', padding: 10 }]}><Avatar p={p} size={40} /><View style={{ marginLeft: 12 }}><Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{p.name}</Text><Text style={{ color: '#9a9aa2', fontSize: 13 }}>ID {p.id}</Text></View></View>
          </Press>
        )} />
    </View>
  );
}

function RecentMusic({ chatId, onSend }) {
  const L = [];
  for (const [c, ms] of Object.entries(S.msgs)) for (const m of ms || []) if (!m.d && m.fl && !m.fl.vo && (m.fl.ty || '').startsWith('audio/')) L.push({ c, m });
  L.sort((a, b) => b.m.t - a.m.t);
  if (!L.length) return null;
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ color: '#9a9aa2', fontSize: 12.5, fontWeight: '700', letterSpacing: 0.4, marginLeft: 6, marginBottom: 6 }}>НЕДАВНЯЯ МУЗЫКА</Text>
      {L.slice(0, 20).map(({ c, m }) => (
        <Press key={c + m.i} onPress={() => onSend({ c, i: m.i })} pop round={16} amt={0.03} style={{ marginBottom: 6 }}>
          <View style={[st.grp, { flexDirection: 'row', alignItems: 'center', padding: 10 }]}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#e93d82', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="play" size={18} color="#fff" style={{ marginLeft: 2 }} /></View>
            <View style={{ marginLeft: 12, flex: 1 }}><Text numberOfLines={1} style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{String(m.fl.n || 'audio').replace(/\.[a-z0-9]+$/i, '')}</Text><Text style={{ color: '#9a9aa2', fontSize: 13 }}>{Math.max(1, Math.round((m.fl.sz || 0) / 1024))} КБ</Text></View>
          </View>
        </Press>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  panel: { flex: 1, backgroundColor: '#1c1c1e', borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,.07)', overflow: 'hidden' },
  grab: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,.25)', marginTop: 8 },
  grp: { borderRadius: 18, backgroundColor: 'rgba(255,255,255,.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,.06)' },
  sep: { height: 1, backgroundColor: 'rgba(255,255,255,.07)', marginLeft: 64 },
  tile: { backgroundColor: '#2a2a2e', alignItems: 'center', justifyContent: 'center' },
  tb: { color: '#fff', fontWeight: '700', fontSize: 14, marginTop: 6 },
  ts: { color: '#9a9aa2', fontSize: 12, marginTop: 2 },
  ck: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 1.8, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,.2)', alignItems: 'center', justifyContent: 'center' },
  dur: { position: 'absolute', left: 5, bottom: 5, backgroundColor: 'rgba(0,0,0,.55)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  blueBtn: { height: 46, paddingHorizontal: 26, borderRadius: 23, backgroundColor: '#3e88f7', alignItems: 'center', justifyContent: 'center' },
});
