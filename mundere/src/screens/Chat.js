// Переписка: перевёрнутый список (быстрый на длинных чатах), стеклянная шапка и поле ввода,
// меню сообщения-пузырёк с реакциями, ответы, фото, голосовые, группы и каналы.
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, TextInput, FlatList, KeyboardAvoidingView, Platform, Animated, Pressable, Modal, StyleSheet, Dimensions, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { S, useStore, isG, openChat, closeChat, older, sendText, loadPeers, poke, emit } from '../store';
import { M, ms, fileUri, authed, upload } from '../api';
import { C, Glass, GlassBtn, Press, Avatar, GAvatar, Vf, hm, dayLabel, seen, gN, ucol, toast, tap } from '../ui';

const REACT = ['❤️', '👍', '😂', '😮', '😢', '🔥'];
const { width: SW } = Dimensions.get('window');
const MAXW = Math.min(SW * 0.78, 360);

export default function Chat({ route, navigation }) {
  useStore();
  const { c } = route.params; const peer = route.params.peer || null;
  const G = isG(c) ? S.G[c] : null, p = peer ? S.peers[peer] : null, self = peer && String(peer) === String(M.me);
  const ins = useSafeAreaInsets();
  const [txt, setTxt] = useState('');
  const [reply, setReply] = useState(null);
  const [menu, setMenu] = useState(null);
  const [sending, setSending] = useState(0);
  const lastTy = useRef(0);
  const to = G ? c : peer;
  const canW = !G || G.type !== 'channel' || G.admin;

  useEffect(() => { openChat(c); if (peer) loadPeers([peer], true); return () => closeChat(c); }, [c]);
  useEffect(() => { setAudioModeAsync({ playsInSilentMode: true }).catch(() => {}); }, []);

  const L = S.msgs[c];
  const rows = useMemo(() => {
    if (!L) return [];
    const out = []; let day = '';
    const V = L.filter(m => !m.d);
    V.forEach((m, k) => {
      const d = new Date(m.t).toDateString();
      if (d !== day) { day = d; out.push({ k: 'd' + m.i, day: m.t }); }
      const prev = V[k - 1], next = V[k + 1];
      const same = (a, b) => a && b && !a.sys && !b.sys && String(a.f) === String(b.f) && Math.abs(a.t - b.t) < 120000 && new Date(a.t).toDateString() === new Date(b.t).toDateString();
      out.push({ k: 'm' + (m.tmp || m.i), m, first: !same(prev, m), last: !same(m, next) });
    });
    return out.reverse();
  }, [L, S.rx[c], S.ed[c], S.read[c], Object.keys(S.peers).length]);

  const typing = S.typing[c];
  const status = G ? (typing && G.type !== 'channel' ? ((S.peers[typing] || {}).name || 'Кто-то') + ' печатает…' : gN(G)) : self ? '' : typing ? 'печатает…' : seen(p);

  function onType(v) {
    setTxt(v);
    const now = Date.now();
    if (v && now - lastTy.current > 3000 && !self && !(G && G.type === 'channel')) { lastTy.current = now; ms('typing', { c }).catch(() => {}); }
  }
  async function send() {
    const x = txt.trim(); if (!x) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setTxt(''); const r = reply ? reply.i : null; setReply(null);
    try { await sendText(to, c, x, r); } catch (e) { toast(e.message, 1); }
  }
  async function attach() {
    const pr = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!pr.granted) return toast('Разреши доступ к фото в настройках', 1);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10, quality: 1 });
    if (res.canceled) return;
    const cap = txt.trim(); setTxt('');
    for (let k = 0; k < res.assets.length; k++) {
      const a = res.assets[k];
      const tmp = 'p' + Date.now() + k;
      S.msgs[c] = [...(S.msgs[c] || []), { i: 2e12 + Date.now() + k, tmp, f: M.me, t: Date.now(), x: k === 0 ? cap : '', fl: { local: a.uri, ty: 'image/jpeg', w: a.width, h: a.height } }]; emit();
      setSending(s => s + 1);
      try {
        const w = Math.min(a.width || 1600, 1600);
        const r = await ImageManipulator.manipulateAsync(a.uri, [{ resize: { width: w } }], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG, base64: true });
        const name = 'photo_' + Date.now() + '.jpg', size = Math.round(r.base64.length * 0.75);
        const id = await upload(to, r.base64, { name, type: 'image/jpeg', size });
        const j = await ms('send', { to, x: k === 0 ? cap : '', fl: { id, n: name, ty: 'image/jpeg', sz: size, w: r.width, h: r.height } });
        const Lm = S.msgs[c] || [];
        S.msgs[c] = Lm.some(z => z.i === j.m.i) ? Lm.filter(z => z.tmp !== tmp) : Lm.map(z => (z.tmp === tmp ? j.m : z));
        emit(); poke();
      } catch (e) { S.msgs[c] = (S.msgs[c] || []).filter(z => z.tmp !== tmp); emit(); toast(e.message, 1); }
      setSending(s => s - 1);
    }
  }

  const onLong = useCallback((m, e) => {
    if (m.tmp) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setMenu({ m, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
  }, []);
  const openImg = useCallback(m => navigation.navigate('Viewer', { uri: fileUri(m.fl.id), w: m.fl.w, h: m.fl.h, name: m.fl.n }), []);
  const openUser = useCallback(id => navigation.navigate('Profile', { id: String(id) }), []);

  const findMsg = i => (S.msgs[c] || []).find(x => x.i === i);

  const renderItem = useCallback(({ item }) => {
    if (item.day) return <View style={{ alignItems: 'center', marginVertical: 8 }}><Glass round={12} style={{ paddingHorizontal: 12, paddingVertical: 4 }}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{dayLabel(item.day)}</Text></Glass></View>;
    const m = item.m;
    if (m.sys) return <SysChip m={m} G={G} onUser={openUser} />;
    return <Bubble c={c} m={m} G={G} first={item.first} last={item.last} reply={m.r != null ? findMsg(m.r) : null} onLong={onLong} onImg={openImg} onUser={openUser} onReply={() => canW && setReply(m)} />;
  }, [c, G, rows]);

  const hdr = G ? () => navigation.navigate('GroupInfo', { c }) : () => navigation.navigate('Profile', { id: String(peer) });

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <LinearGradient colors={['#0e1621', '#0b0f17', '#000']} style={StyleSheet.absoluteFill} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={0}>
        {!L ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.blue} /></View> : (
          <FlatList
            inverted
            data={rows}
            keyExtractor={r => r.k}
            renderItem={renderItem}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: ins.top + 70, paddingHorizontal: 8 }}
            onEndReached={() => older(c)}
            onEndReachedThreshold={0.4}
            initialNumToRender={20}
            maxToRenderPerBatch={12}
            windowSize={11}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<View style={{ transform: [{ scaleY: -1 }], alignItems: 'center', marginTop: 120 }}><Glass round={20} style={{ padding: 20, alignItems: 'center' }}><Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Здесь пока пусто</Text><Text style={{ color: C.mute, marginTop: 6 }}>{canW ? 'Напиши первое сообщение' : 'Публикаций пока нет'}</Text></Glass></View>}
          />
        )}

        {canW ? (
          <View style={{ paddingHorizontal: 8, paddingBottom: Math.max(ins.bottom, 8) + 2, paddingTop: 6 }}>
            {reply && (
              <Glass round={16} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6 }}>
                <Ionicons name="arrow-undo" size={18} color={C.blue} />
                <View style={{ flex: 1, marginLeft: 10, borderLeftWidth: 2, borderLeftColor: C.blue, paddingLeft: 8 }}>
                  <Text style={{ color: C.blue, fontWeight: '700', fontSize: 13 }}>{String(reply.f) === String(M.me) ? 'Вы' : (S.peers[reply.f] || {}).name || 'Сообщение'}</Text>
                  <Text numberOfLines={1} style={{ color: '#ddd', fontSize: 14 }}>{reply.x || (reply.fl ? (reply.fl.vo ? 'Голосовое' : reply.fl.ty && reply.fl.ty.startsWith('image/') ? 'Фото' : reply.fl.n) : '')}</Text>
                </View>
                <Pressable onPress={() => setReply(null)} hitSlop={10}><Ionicons name="close" size={20} color={C.mute} /></Pressable>
              </Glass>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              <GlassBtn icon="attach" onPress={attach} />
              <Glass round={22} style={{ flex: 1, marginHorizontal: 6, minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 }}>
                <TextInput value={txt} onChangeText={onType} placeholder={G && G.type === 'channel' ? 'Публикация' : 'Сообщение'} placeholderTextColor={C.mute} multiline style={{ color: '#fff', fontSize: 16.5, maxHeight: 130, paddingTop: Platform.OS === 'ios' ? 11 : 8, paddingBottom: Platform.OS === 'ios' ? 11 : 8 }} selectionColor={C.blue} />
              </Glass>
              <SendBtn on={!!txt.trim()} onPress={send} busy={sending > 0} />
            </View>
          </View>
        ) : (
          <View style={{ alignItems: 'center', paddingBottom: Math.max(ins.bottom, 8) + 4, paddingTop: 8 }}>
            <Press onPress={() => toast('Канал без звука')}><Glass round={24} style={{ paddingHorizontal: 26, height: 48, flexDirection: 'row', alignItems: 'center' }}><Ionicons name="notifications-off-outline" size={20} color="#fff" /><Text style={{ color: '#fff', fontSize: 16, fontWeight: '600', marginLeft: 8 }}>Выключить звук</Text></Glass></Press>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* шапка поверх списка — стекло */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: ins.top + 4, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' }}>
        <GlassBtn icon="chevron-back" onPress={() => navigation.goBack()} />
        <Press onPress={hdr} scale={0.95} style={{ flex: 1, marginHorizontal: 8 }}>
          <Glass round={22} style={{ height: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text numberOfLines={1} style={{ color: '#fff', fontWeight: '700', fontSize: 15.5, flexShrink: 1 }}>{G ? G.title : self ? 'Избранное' : p ? p.name : '…'}</Text>
              <Vf on={G ? G.vf : p && p.verified} size={14} />
            </View>
            {!!status && <Text numberOfLines={1} style={{ color: typing ? C.blue : C.mute, fontSize: 12 }}>{status}</Text>}
          </Glass>
        </Press>
        <Press onPress={hdr}>{G ? <GAvatar g={G} size={44} /> : <Avatar p={p} size={44} />}</Press>
      </View>

      {menu && <MsgMenu c={c} G={G} menu={menu} canW={canW} onClose={() => setMenu(null)} onReply={m => setReply(m)} />}
    </View>
  );
}

function SendBtn({ on, onPress, busy }) {
  const a = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => { Animated.spring(a, { toValue: on ? 1 : 0, useNativeDriver: true, speed: 20, bounciness: 12 }).start(); }, [on]);
  return (
    <Press onPress={onPress} disabled={!on}>
      <Animated.View style={{ transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }], opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: on ? C.blue : 'rgba(255,255,255,.12)', alignItems: 'center', justifyContent: 'center' }}>
          {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="arrow-up" size={24} color="#fff" />}
        </View>
      </Animated.View>
    </Press>
  );
}

function SysChip({ m, G, onUser }) {
  const ch = G && G.type === 'channel', me = String(m.f) === String(M.me);
  const N = id => String(id) === String(M.me) ? 'Вы' : (S.peers[id] || {}).name || 'ID ' + id;
  const W = id => <Text key={id} onPress={() => onUser(id)} style={{ fontWeight: '800' }}>{N(id)}</Text>;
  const us = (m.u || []).map((id, k) => <Text key={k}>{k ? ', ' : ''}{W(id)}</Text>);
  const t = m.sys === 'new' ? (m.st === 'channel' ? <Text>Канал «{G ? G.title : ''}» создан</Text> : <Text>{W(m.f)} {me ? 'создали' : 'создал(а)'} группу «{G ? G.title : ''}»</Text>)
    : m.sys === 'add' ? <Text>{W(m.f)} {me ? 'добавили' : 'добавил(а)'} {us}</Text>
    : m.sys === 'kick' ? <Text>{W(m.f)} {me ? 'удалили' : 'удалил(а)'} {us}</Text>
    : m.sys === 'left' ? <Text>{W(m.f)} {me ? 'покинули' : 'покинул(а)'} группу</Text>
    : m.sys === 'join' ? <Text>{W(m.f)} {me ? (ch ? 'подписались' : 'вступили в группу по ссылке') : ch ? 'подписался(ась)' : 'вступил(а) в группу по ссылке'}</Text> : null;
  if (!t) return null;
  return <View style={{ alignItems: 'center', marginVertical: 6, paddingHorizontal: 30 }}><Glass round={14} style={{ paddingHorizontal: 12, paddingVertical: 5 }}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '500', textAlign: 'center' }}>{t}</Text></Glass></View>;
}

const Bubble = React.memo(function Bubble({ c, m, G, first, last, reply, onLong, onImg, onUser, onReply }) {
  const mine = String(m.f) === String(M.me);
  const gs = G && G.type !== 'channel' && !mine;
  const ed = S.ed[c] && S.ed[c][m.i];
  const x = ed != null ? (typeof ed === 'object' ? ed.x : ed) : m.x;
  const rd = mine && !m.tmp && (S.read[c] ?? -1) >= m.i;
  const fl = m.fl;
  const isImg = fl && (fl.local || (fl.ty || '').startsWith('image/')) && !fl.rd;
  const rx = S.rx[c] && S.rx[c][m.i];
  const pop = useRef(new Animated.Value(m.tmp ? 0 : 1)).current;
  useEffect(() => { if (m.tmp) Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 10 }).start(); }, []);
  const bg = mine ? C.me : C.th;
  const r = 18, sm = 6;
  const radius = mine
    ? { borderTopLeftRadius: r, borderBottomLeftRadius: r, borderTopRightRadius: first ? r : sm, borderBottomRightRadius: last ? r : sm }
    : { borderTopRightRadius: r, borderBottomRightRadius: r, borderTopLeftRadius: first ? r : sm, borderBottomLeftRadius: last ? r : sm };
  const iw = isImg ? Math.min(MAXW, 280) : 0, ih = isImg ? Math.min(360, Math.max(120, iw * ((fl.h || 3) / (fl.w || 4)))) : 0;
  const meta = (
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginLeft: 8, marginTop: 2 }}>
      {ed != null && <Text style={{ color: mine ? '#cfe0ff' : C.mute, fontSize: 11, marginRight: 4 }}>изм.</Text>}
      <Text style={{ color: mine ? '#cfe0ff' : C.mute, fontSize: 11.5 }}>{hm(m.t)}</Text>
      {mine && !(G && G.type === 'channel') && (m.err ? <Ionicons name="alert-circle" size={14} color={C.red} style={{ marginLeft: 3 }} /> : m.tmp ? <Ionicons name="time-outline" size={13} color="#cfe0ff" style={{ marginLeft: 3 }} /> : <Ionicons name={rd ? 'checkmark-done' : 'checkmark'} size={15} color="#cfe0ff" style={{ marginLeft: 3 }} />)}
    </View>
  );
  return (
    <Animated.View style={{ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: first ? 6 : 2, opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }}>
      {gs && <View style={{ width: 38, justifyContent: 'flex-end' }}>{last && <Pressable onPress={() => onUser(m.f)}><Avatar p={S.peers[m.f]} size={32} /></Pressable>}</View>}
      <Pressable onLongPress={e => onLong(m, e)} delayLongPress={280} onPress={isImg && !fl.local ? () => onImg(m) : undefined} style={{ maxWidth: MAXW }}>
        <View style={[{ backgroundColor: bg, overflow: 'hidden' }, radius, isImg ? { padding: 3 } : { paddingHorizontal: 11, paddingVertical: 7 }]}>
          {gs && first && <Text onPress={() => onUser(m.f)} style={{ color: ucol(m.f), fontWeight: '700', fontSize: 13.5, marginBottom: 2, marginHorizontal: isImg ? 8 : 0, marginTop: isImg ? 4 : 0 }}>{(S.peers[m.f] || {}).name || 'ID ' + m.f}</Text>}
          {m.fw != null && <Text style={{ color: mine ? '#cfe0ff' : C.blue, fontSize: 13, marginBottom: 2 }}>Переслано от {(S.peers[m.fw] || {}).name || 'ID ' + m.fw}</Text>}
          {reply && (
            <View style={{ borderLeftWidth: 3, borderLeftColor: mine ? '#fff' : C.blue, backgroundColor: mine ? 'rgba(255,255,255,.12)' : 'rgba(47,140,255,.12)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 4, margin: isImg ? 4 : 0 }}>
              <Text style={{ color: mine ? '#fff' : C.blue, fontWeight: '700', fontSize: 13 }}>{String(reply.f) === String(M.me) ? 'Вы' : (S.peers[reply.f] || {}).name || 'Сообщение'}</Text>
              <Text numberOfLines={1} style={{ color: mine ? '#e6eeff' : '#ccc', fontSize: 13.5 }}>{reply.d ? 'Удалённое сообщение' : reply.x || (reply.fl ? (reply.fl.vo ? 'Голосовое' : (reply.fl.ty || '').startsWith('image/') ? 'Фото' : reply.fl.n) : '')}</Text>
            </View>
          )}
          {isImg && <Image source={fl.local ? { uri: fl.local } : authed(fileUri(fl.id))} style={{ width: iw, height: ih, borderRadius: 15 }} contentFit="cover" transition={200} cachePolicy="memory-disk" recyclingKey={String(m.i)} />}
          {fl && !isImg && fl.vo && <Voice m={m} mine={mine} />}
          {fl && !isImg && !fl.vo && <FileRow fl={fl} mine={mine} />}
          {!!x && <Text style={{ color: '#fff', fontSize: 16.5, lineHeight: 22, marginHorizontal: isImg ? 8 : 0, marginTop: isImg ? 4 : 0 }} selectable={false}>{x}</Text>}
          <View style={isImg && !x ? { position: 'absolute', right: 10, bottom: 8, backgroundColor: 'rgba(0,0,0,.45)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 } : { marginHorizontal: isImg ? 8 : 0, marginBottom: isImg ? 4 : 0 }}>{meta}</View>
        </View>
        {rx && <Reacts rx={rx} mine={mine} c={c} i={m.i} />}
      </Pressable>
    </Animated.View>
  );
});

function Reacts({ rx, mine, c, i }) {
  // на сервере реакции хранятся как {ID человека: эмодзи}
  const by = {};
  for (const [u, e] of Object.entries(rx || {})) { if (!by[e]) by[e] = { e, n: 0, me: false }; by[e].n++; if (String(u) === String(M.me)) by[e].me = true; }
  const list = Object.values(by);
  if (!list.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: 3 }}>
      {list.map(r => (
        <Press key={r.e} onPress={() => ms('react', { c, i, e: r.e }).then(poke).catch(() => {})} style={{ marginRight: 4, marginTop: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: r.me ? C.blue : 'rgba(255,255,255,.14)', borderRadius: 14, paddingHorizontal: 8, height: 28 }}>
            <Text style={{ fontSize: 15 }}>{r.e}</Text>{r.n > 1 && <Text style={{ color: '#fff', fontSize: 13, marginLeft: 3, fontWeight: '600' }}>{r.n}</Text>}
          </View>
        </Press>
      ))}
    </View>
  );
}

function FileRow({ fl, mine }) {
  const kb = fl.sz > 1048576 ? (fl.sz / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round((fl.sz || 0) / 1024)) + ' КБ';
  const vid = (fl.ty || '').startsWith('video/') || fl.rd;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 200, paddingVertical: 2 }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: mine ? 'rgba(255,255,255,.2)' : C.blue, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={vid ? 'play' : 'document'} size={20} color="#fff" />
      </View>
      <View style={{ marginLeft: 10, flexShrink: 1 }}>
        <Text numberOfLines={1} style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>{fl.rd ? 'Видеосообщение' : fl.n}</Text>
        <Text style={{ color: mine ? '#cfe0ff' : C.mute, fontSize: 13 }}>{kb}{vid ? ' · видео' : ''}</Text>
      </View>
    </View>
  );
}

// Голосовое: проигрыватель создаётся только при нажатии — список остаётся лёгким
function Voice({ m, mine }) {
  const [st, setSt] = useState({ play: false, pos: 0, dur: (m.fl.d || 0) });
  const pl = useRef(null);
  useEffect(() => () => { try { pl.current && pl.current.remove(); } catch (e) {} }, []);
  function toggle() {
    tap();
    if (!pl.current) {
      const p = createAudioPlayer(authed(fileUri(m.fl.id)));
      p.addListener('playbackStatusUpdate', s => {
        setSt(o => ({ play: !!s.playing, pos: s.currentTime || 0, dur: s.duration || o.dur }));
        if (s.didJustFinish) { try { p.seekTo(0); } catch (e) {} setSt(o => ({ ...o, play: false, pos: 0 })); }
      });
      pl.current = p; p.play(); setSt(o => ({ ...o, play: true })); return;
    }
    if (st.play) pl.current.pause(); else pl.current.play();
  }
  const bars = useMemo(() => Array.from({ length: 28 }, (_, k) => 4 + Math.abs(Math.sin((m.i + 1) * 7.3 + k * 1.7)) * 16), [m.i]);
  const fr = st.dur ? st.pos / st.dur : 0;
  const t = Math.round(st.play || st.pos ? st.pos : st.dur);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 210, paddingVertical: 2 }}>
      <Press onPress={toggle}>
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: mine ? '#fff' : C.blue, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={st.play ? 'pause' : 'play'} size={20} color={mine ? C.me : '#fff'} style={{ marginLeft: st.play ? 0 : 2 }} />
        </View>
      </Press>
      <View style={{ marginLeft: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 22 }}>
          {bars.map((h, k) => <View key={k} style={{ width: 3, height: h, borderRadius: 2, marginRight: 2, backgroundColor: k / bars.length <= fr ? (mine ? '#fff' : C.blue) : mine ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.3)' }} />)}
        </View>
        <Text style={{ color: mine ? '#cfe0ff' : C.mute, fontSize: 12, marginTop: 2 }}>{Math.floor(t / 60)}:{String(t % 60).padStart(2, '0')}</Text>
      </View>
    </View>
  );
}

// Меню сообщения: затемнение, реакции и пункты выплывают пузырьком от пальца
function MsgMenu({ c, G, menu, canW, onClose, onReply }) {
  const a = useRef(new Animated.Value(0)).current;
  const { m } = menu, mine = String(m.f) === String(M.me);
  const { width: W, height: H } = Dimensions.get('window');
  useEffect(() => { Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 9 }).start(); }, []);
  const close = cb => Animated.timing(a, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => { onClose(); cb && cb(); });
  const canAll = mine || (G && G.admin);
  const items = [
    ...(canW ? [{ t: 'Ответить', ic: 'arrow-undo-outline', fn: () => onReply(m) }] : []),
    ...(m.x ? [{ t: 'Копировать', ic: 'copy-outline', fn: () => { Clipboard.setStringAsync(m.x); toast('Скопировано'); } }] : []),
    ...(mine && m.x && !m.fl ? [] : []),
    { t: 'Удалить у меня', ic: 'trash-outline', red: 1, fn: () => del(0) },
    ...(canAll ? [{ t: 'Удалить у всех', ic: 'trash', red: 1, fn: () => del(1) }] : []),
  ];
  async function del(all) {
    S.msgs[c] = (S.msgs[c] || []).map(z => (z.i === m.i ? { ...z, d: 1 } : z)); emit();
    try { await ms('del', { c, i: m.i, all }); poke(); } catch (e) { toast(e.message, 1); }
  }
  const mw = 240, mh = items.length * 48 + 12, rh = 52;
  const left = Math.max(10, Math.min(menu.x - mw / 2, W - mw - 10));
  let top = menu.y + 12; if (top + mh + rh + 30 > H) top = Math.max(60, menu.y - mh - rh - 24);
  const sc = a.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
  const ty = a.interpolate({ inputRange: [0, 1], outputRange: [menu.y - top - 40, 0] });
  return (
    <Modal transparent visible animationType="none" onRequestClose={() => close()} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => close()}><Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,.55)', opacity: a }]} /></Pressable>
      <Animated.View style={{ position: 'absolute', left: Math.max(10, Math.min(menu.x - 160, W - 330)), top, opacity: a, transform: [{ translateY: ty }, { scale: sc }] }}>
        <Glass round={26} intensity={60} style={{ flexDirection: 'row', paddingHorizontal: 6, height: rh, alignItems: 'center', backgroundColor: Platform.OS === 'android' ? 'rgba(40,40,46,.92)' : undefined }}>
          {REACT.map((e, k) => <Press key={e} scale={1.35} onPress={() => close(() => ms('react', { c, i: m.i, e }).then(poke).catch(err => toast(err.message, 1)))} style={{ width: 50, alignItems: 'center' }}><Text style={{ fontSize: 28 }}>{e}</Text></Press>)}
        </Glass>
      </Animated.View>
      <Animated.View style={{ position: 'absolute', left, top: top + rh + 10, width: mw, opacity: a, transform: [{ translateY: ty }, { scale: sc }] }}>
        <Glass round={24} intensity={60} style={{ paddingVertical: 6, backgroundColor: Platform.OS === 'android' ? 'rgba(40,40,46,.92)' : undefined }}>
          {items.map((it, k) => (
            <Pressable key={k} onPress={() => close(it.fn)} style={({ pressed }) => [{ height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginHorizontal: 6, borderRadius: 16 }, pressed && { backgroundColor: 'rgba(255,255,255,.1)' }]}>
              <Text style={{ flex: 1, color: it.red ? C.red : '#fff', fontSize: 16 }}>{it.t}</Text>
              <Ionicons name={it.ic} size={20} color={it.red ? C.red : '#fff'} />
            </Pressable>
          ))}
        </Glass>
      </Animated.View>
    </Modal>
  );
}
