// Переписка: перевёрнутый список (быстрый на длинных чатах), стеклянная шапка и поле ввода,
// меню сообщения-пузырёк с реакциями, ответы, фото, голосовые, группы и каналы.
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Linking } from 'react-native';
import { View, Text, TextInput, FlatList, KeyboardAvoidingView, Platform, Animated, Pressable, Modal, StyleSheet, Dimensions, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync, useAudioRecorder, RecordingPresets, AudioModule } from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as MediaLibrary from 'expo-media-library';
import { EDIT } from './PhotoEdit';
import AttachSheet, { MapTiles } from '../AttachSheet';
import { BASE } from '../api';
import { PanResponder } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { S, useStore, isG, openChat, closeChat, older, sendText, loadPeers, poke, emit, toggleMute } from '../store';
import { M, ms, fileUri, authed, upload } from '../api';
import { C, Glass, GlassBtn, Press, Avatar, GAvatar, Vf, hm, dayLabel, seen, gN, ucol, toast, tap, bubble, Wallpaper } from '../ui';

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
  const pinI = S.pin[c], pinM = pinI != null && pinI >= 0 && L ? L.find(m => m.i === pinI && !m.d) : null;
  const status = G ? (typing && G.type !== 'channel' ? ((S.peers[typing] || {}).name || 'Кто-то') + ' печатает…' : gN(G)) : self ? '' : typing ? 'печатает…' : seen(p);

  function onType(v) {
    setTxt(v);
    const now = Date.now();
    if (v && now - lastTy.current > 3000 && !self && !(G && G.type === 'channel')) { lastTy.current = now; ms('typing', { c }).catch(() => {}); }
  }
  const [editing, setEditing] = useState(null);
  async function send() {
    const x = txt.trim(); if (!x) return;
    if (editing) {
      const m = editing; setEditing(null); setTxt('');
      S.ed[c] = { ...(S.ed[c] || {}), [m.i]: { x } }; emit();
      try { await ms('edit', { c, i: m.i, x }); poke(); } catch (e) { toast(e.message, 1); }
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setTxt(''); const r = reply ? reply.i : null; setReply(null);
    try { await sendText(to, c, x, r); } catch (e) { toast(e.message, 1); }
  }
  // общий отправитель файла: временный пузырь сразу, потом загрузка кусками и отправка
  async function sendFile(f, cap) {
    const tmp = 'p' + Date.now() + Math.random();
    S.msgs[c] = [...(S.msgs[c] || []), { i: 2e12 + Date.now(), tmp, f: M.me, t: Date.now(), x: cap || '', fl: { local: f.uri, ty: f.type, n: f.name, w: f.w, h: f.h, d: f.d, vo: f.vo, wf: f.wf, sz: f.size, rd: f.rd, th: f.th } }]; emit();
    setSending(n => n + 1);
    try {
      if (f.size > 12 * 1024 * 1024) throw new Error('Файл больше 12 МБ');
      const b64 = f.b64 || (await FileSystem.readAsStringAsync(f.uri, { encoding: FileSystem.EncodingType.Base64 }));
      const size = Math.round(b64.length * 0.75);
      const id = await upload(to, b64, { name: f.name, type: f.type, size });
      const j = await ms('send', { to, x: cap || '', ...(reply ? {} : {}), fl: { id, n: f.name, ty: f.type, sz: size, w: f.w || 0, h: f.h || 0, d: f.d || 0, ...(f.vo ? { vo: 1, wf: f.wf || '' } : {}), ...(f.rd ? { rd: 1, th: f.th || '' } : {}) } });
      const Lm = S.msgs[c] || [];
      S.msgs[c] = Lm.some(z => z.i === j.m.i) ? Lm.filter(z => z.tmp !== tmp) : Lm.map(z => (z.tmp === tmp ? j.m : z));
      emit(); poke();
    } catch (e) { S.msgs[c] = (S.msgs[c] || []).filter(z => z.tmp !== tmp); emit(); toast(e.message, 1); }
    setSending(n => n - 1);
  }
  async function pickMedia() {
    const pr = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!pr.granted) return toast('Разреши доступ к фото и видео в настройках', 1);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 10, quality: 1, videoMaxDuration: 600 });
    if (res.canceled) return;
    const cap = txt.trim();
    // одно фото — открываем предпросмотр с редактором и подписью, как в Telegram
    if (res.assets.length === 1 && res.assets[0].type !== 'video') {
      const a = res.assets[0];
      EDIT.done = r => sendFile({ uri: r.uri, b64: r.b64, name: 'photo_' + Date.now() + '.jpg', type: 'image/jpeg', size: Math.round(r.b64.length * 0.75), w: r.w, h: r.h }, r.cap);
      setTxt('');
      return navigation.navigate('PhotoEdit', { uri: a.uri, w: a.width, h: a.height, cap });
    }
    setTxt('');
    for (let k = 0; k < res.assets.length; k++) {
      const a = res.assets[k], cp = k === 0 ? cap : '';
      if (a.type === 'video') {
        await sendFile({ uri: a.uri, name: a.fileName || 'video_' + Date.now() + '.mp4', type: a.mimeType || 'video/mp4', size: a.fileSize || 0, w: a.width, h: a.height, d: Math.round((a.duration || 0) / 1000) }, cp);
      } else {
        try {
          const w = Math.min(a.width || 1600, 1600);
          const r = await ImageManipulator.manipulateAsync(a.uri, [{ resize: { width: w } }], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG, base64: true });
          await sendFile({ uri: r.uri, b64: r.base64, name: 'photo_' + Date.now() + '.jpg', type: 'image/jpeg', size: Math.round(r.base64.length * 0.75), w: r.width, h: r.height }, cp);
        } catch (e) { toast(e.message, 1); }
      }
    }
  }
  async function takePhoto() {
    const pr = await ImagePicker.requestCameraPermissionsAsync();
    if (!pr.granted) return toast('Разреши доступ к камере', 1);
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled) return;
    const a = res.assets[0], cap = txt.trim(); setTxt('');
    EDIT.done = r => sendFile({ uri: r.uri, b64: r.b64, name: 'photo_' + Date.now() + '.jpg', type: 'image/jpeg', size: Math.round(r.b64.length * 0.75), w: r.w, h: r.h }, r.cap);
    navigation.navigate('PhotoEdit', { uri: a.uri, w: a.width, h: a.height, cap });
  }
  async function pickFile() {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    for (const a of res.assets) await sendFile({ uri: a.uri, name: a.name || 'файл', type: a.mimeType || 'application/octet-stream', size: a.size || 0 });
  }
  const [att, setAtt] = useState(false);
  const attach = () => { tap(); setAtt(true); };
  async function pickRaw() {
    const pr = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!pr.granted) return toast('Нет доступа к фото', 1);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 10, quality: 1 });
    if (res.canceled) return;
    for (const a of res.assets) await sendFile({ uri: a.uri, name: a.fileName || ((a.type === 'video' ? 'video_' : 'photo_') + Date.now() + (a.type === 'video' ? '.mp4' : '.jpg')), type: a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg'), size: a.fileSize || 0 });
  }
  async function pickAudio() {
    const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    for (const a of res.assets) await sendFile({ uri: a.uri, name: a.name || 'audio', type: a.mimeType || 'audio/mpeg', size: a.size || 0 });
  }
  async function assetFile(as) { const info = await MediaLibrary.getAssetInfoAsync(as); return info.localUri || info.uri || as.uri; }
  async function sendAssets(L, cap) {
    for (let k = 0; k < L.length; k++) {
      const as = L[k], cp = k === 0 ? cap : '';
      try {
        const uri = await assetFile(as);
        if (as.mediaType === 'video') await sendFile({ uri, name: as.filename || 'video_' + Date.now() + '.mp4', type: 'video/mp4', size: 0, w: as.width, h: as.height, d: Math.round(as.duration || 0) }, cp);
        else {
          const w = Math.min(as.width || 1600, 1600);
          const r = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: w } }], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG, base64: true });
          await sendFile({ uri: r.uri, b64: r.base64, name: 'photo_' + Date.now() + '.jpg', type: 'image/jpeg', size: Math.round(r.base64.length * 0.75), w: r.width, h: r.height }, cp);
        }
      } catch (e) { toast(e.message, 1); }
    }
  }
  async function openAsset(as) {
    if (as.mediaType === 'video') return sendAssets([as], txt.trim());
    const uri = await assetFile(as), cap = txt.trim();
    EDIT.done = r => sendFile({ uri: r.uri, b64: r.b64, name: 'photo_' + Date.now() + '.jpg', type: 'image/jpeg', size: Math.round(r.b64.length * 0.75), w: r.w, h: r.h }, r.cap);
    setTxt(''); navigation.navigate('PhotoEdit', { uri, w: as.width, h: as.height, cap });
  }

  // голосовые: держи кнопку микрофона — запись, отпусти — отправка
  const rec = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const [recOn, setRecOn] = useState(0);
  const recT = useRef({ t0: 0, lv: [], iv: null, want: false });
  // короткое нажатие — переключить голос/кружок, удержание — запись (как в Telegram)
  const [mode, setMode] = useState('mic');
  const [rnd, setRnd] = useState(null); // кружок: {ready, rec, t0}
  const hold = useRef({ tm: null, long: false });
  function holdIn() {
    const H = hold.current; H.long = false;
    H.tm = setTimeout(() => { H.long = true; H.tm = null; if (mode === 'mic') recStart(); else rndStart(); }, 200);
  }
  function holdOut() {
    const H = hold.current;
    if (H.tm) { clearTimeout(H.tm); H.tm = null; tap(); setMode(m => (m === 'mic' ? 'cam' : 'mic')); toast(mode === 'mic' ? 'Удерживай — записать кружок' : 'Удерживай — записать голосовое'); return; }
    if (mode === 'mic') recStop(false); else rndStop();
  }
  const cam = useRef(null);
  const [camPerm, askCam] = useCameraPermissions();
  const [micPerm, askMic] = useMicrophonePermissions();
  const rndWant = useRef(false);
  async function rndStart() {
    rndWant.current = true;
    if (!camPerm || !camPerm.granted) { const r = await askCam(); if (!r.granted) { rndWant.current = false; return toast('Разреши доступ к камере', 1); } }
    if (!micPerm || !micPerm.granted) { const r = await askMic(); if (!r.granted) { rndWant.current = false; return toast('Разреши доступ к микрофону', 1); } }
    if (!rndWant.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRnd({ ready: false, t0: 0 });
  }
  async function rndReady() {
    if (!rndWant.current || !cam.current) return;
    const t0 = Date.now(); setRnd({ ready: true, t0 });
    try {
      const v = await cam.current.recordAsync({ maxDuration: 60 });
      const d = Math.max(1, Math.round((Date.now() - t0) / 1000));
      setRnd(null);
      if (!v || !v.uri || Date.now() - t0 < 800) return;
      let th = '';
      try {
        const t = await VideoThumbnails.getThumbnailAsync(v.uri, { time: 300 });
        const sm = await ImageManipulator.manipulateAsync(t.uri, [{ resize: { width: 120 } }], { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true });
        th = 'data:image/jpeg;base64,' + sm.base64; if (th.length > 6000) th = '';
      } catch (e) {}
      const info = await FileSystem.getInfoAsync(v.uri).catch(() => ({}));
      await sendFile({ uri: v.uri, name: 'round_' + Date.now() + '.mp4', type: 'video/mp4', size: info.size || 0, w: 480, h: 480, d, rd: 1, th });
    } catch (e) { setRnd(null); toast('Не удалось записать кружок', 1); }
  }
  function rndStop() {
    rndWant.current = false;
    try { cam.current && cam.current.stopRecording(); } catch (e) {}
    setRnd(r => (r && !r.ready ? null : r));
  }

  async function recStart() {
    const R0 = recT.current; R0.want = true;
    const pr = await AudioModule.requestRecordingPermissionsAsync();
    if (!pr.granted) { R0.want = false; return toast('Разреши доступ к микрофону', 1); }
    if (!R0.want) return;
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await rec.prepareToRecordAsync(); rec.record();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      R0.t0 = Date.now(); R0.lv = []; setRecOn(Date.now());
      R0.iv = setInterval(() => { try { const st = rec.getStatus(); const db = st && st.metering != null ? st.metering : -60; R0.lv.push(Math.max(0, Math.min(35, Math.round((db + 60) / 60 * 35)))); } catch (e) {} setRecOn(x => x && Date.now()); }, 100);
    } catch (e) { toast('Не удалось начать запись', 1); }
  }
  async function recStop(cancel) {
    const R0 = recT.current; R0.want = false;
    if (!R0.t0) return;
    clearInterval(R0.iv); const dur = (Date.now() - R0.t0) / 1000; R0.t0 = 0; setRecOn(0);
    try { await rec.stop(); } catch (e) {}
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    if (cancel || dur < 0.7) { if (!cancel) toast('Удерживай кнопку, чтобы записать голосовое', 1); return; }
    const L = R0.lv, n = 40, wf = Array.from({ length: n }, (_, k) => { const a = L.slice(Math.floor(k * L.length / n), Math.floor((k + 1) * L.length / n) || undefined); return (a.length ? Math.max(...a) : 0).toString(36); }).join('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const uri = rec.uri; if (!uri) return toast('Запись не сохранилась', 1);
    const info = await FileSystem.getInfoAsync(uri).catch(() => ({}));
    await sendFile({ uri, name: 'voice_' + Date.now() + '.m4a', type: 'audio/mp4', size: info.size || 0, d: Math.max(1, Math.round(dur)), vo: 1, wf });
  }

  const onLong = useCallback((m, e) => {
    if (m.tmp) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setMenu({ m, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
  }, []);
  const openImg = useCallback(m => {
    const fl = m.fl, vid = (fl.ty || '').startsWith('video/') || fl.rd, img = (fl.ty || '').startsWith('image/') && !fl.rd;
    if (img || vid) navigation.navigate('Viewer', { uri: fileUri(fl.id), w: fl.w, h: fl.h, name: fl.n, video: vid ? 1 : 0 });
    else openDoc(fl);
  }, []);
  const openUser = useCallback(id => navigation.navigate('Profile', { id: String(id) }), []);

  const findMsg = i => (S.msgs[c] || []).find(x => x.i === i);

  const renderItem = useCallback(({ item }) => {
    if (item.day) return <View style={{ alignItems: 'center', marginVertical: 8 }}><View style={{ borderRadius: 12, paddingHorizontal: 11, paddingVertical: 4, backgroundColor: 'rgba(30,30,32,.7)' }}><Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '600' }}>{dayLabel(item.day)}</Text></View></View>;
    const m = item.m;
    if (m.sys) return <SysChip m={m} G={G} onUser={openUser} />;
    return <Bubble c={c} m={m} G={G} first={item.first} last={item.last} reply={m.r != null ? findMsg(m.r) : null} onLong={onLong} onImg={openImg} onUser={openUser} onReply={() => canW && setReply(m)} />;
  }, [c, G, rows]);

  const hdr = G ? () => navigation.navigate('GroupInfo', { c }) : () => navigation.navigate('Profile', { id: String(peer) });

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Wallpaper />
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
          <View style={{ paddingHorizontal: 10, paddingBottom: Math.max(ins.bottom, 10), paddingTop: 6 }}>
            {editing && (
              <Glass round={16} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6 }}>
                <Ionicons name="pencil" size={18} color={C.blue} />
                <View style={{ flex: 1, marginLeft: 10, borderLeftWidth: 2, borderLeftColor: C.blue, paddingLeft: 8 }}>
                  <Text style={{ color: C.blue, fontWeight: '700', fontSize: 13 }}>Редактирование</Text>
                  <Text numberOfLines={1} style={{ color: '#ddd', fontSize: 14 }}>{editing.x}</Text>
                </View>
                <Pressable onPress={() => { setEditing(null); setTxt(''); }} hitSlop={10}><Ionicons name="close" size={20} color={C.mute} /></Pressable>
              </Glass>
            )}
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
              {recOn ? (
                <Glass round={25} style={{ flex: 1, marginHorizontal: 8, height: 50, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }}>
                  <RecDot />
                  <Text style={{ color: '#fff', fontSize: 16, marginLeft: 8, fontVariant: ['tabular-nums'] }}>{(() => { const t = Math.floor((Date.now() - recT.current.t0) / 1000); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); })()}</Text>
                  <Text style={{ color: C.mute, fontSize: 14, marginLeft: 'auto' }}>отпусти — отправить</Text>
                </Glass>
              ) : (
              <Glass round={25} style={{ flex: 1, marginHorizontal: 8, minHeight: 50, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 10 }}>
                <TextInput value={txt} onChangeText={onType} placeholder={G && G.type === 'channel' ? 'Публикация' : 'Сообщение'} placeholderTextColor="#8e8e93" multiline style={{ flex: 1, color: '#fff', fontSize: 17, maxHeight: 130, paddingTop: Platform.OS === 'ios' ? 14 : 10, paddingBottom: Platform.OS === 'ios' ? 14 : 10 }} selectionColor={C.blue} />
                <Ionicons name="happy-outline" size={24} color="#cfcfd6" />
              </Glass>
              )}
              {txt.trim() ? <SendBtn on onPress={send} busy={sending > 0} /> : (
                <Pressable onPressIn={holdIn} onPressOut={holdOut} hitSlop={8}>
                  <MicBtn on={!!recOn || !!rnd} mode={mode} busy={sending > 0 && !recOn} />
                </Pressable>
              )}
            </View>
          </View>
        ) : (
          <View style={{ alignItems: 'center', paddingBottom: Math.max(ins.bottom, 8) + 4, paddingTop: 8 }}>
            <Press onPress={() => toast(toggleMute(c) ? 'Уведомления выключены' : 'Уведомления включены')} pop round={24} amt={0.08}><Glass round={24} style={{ paddingHorizontal: 26, height: 48, flexDirection: 'row', alignItems: 'center' }}><Ionicons name={S.muted && S.muted[c] ? 'volume-high-outline' : 'notifications-off-outline'} size={20} color="#fff" /><Text style={{ color: '#fff', fontSize: 16, fontWeight: '600', marginLeft: 8 }}>{S.muted && S.muted[c] ? 'Включить звук' : 'Выключить звук'}</Text></Glass></Press>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* шапка поверх списка — стекло */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: ins.top + 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center' }}>
        <GlassBtn icon="chevron-back" onPress={() => navigation.goBack()} />
        <Press onPress={hdr} pop round={22} amt={0.06} style={{ flex: 1, marginHorizontal: 8 }}>
          <Glass round={24} style={{ height: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text numberOfLines={1} style={{ color: '#fff', fontWeight: '700', fontSize: 15.5, flexShrink: 1 }}>{G ? G.title : self ? 'Избранное' : p ? p.name : '…'}</Text>
              <Vf on={G ? G.vf : p && p.verified} size={14} />
            </View>
            {!!status && <Text numberOfLines={1} style={{ color: typing ? C.blue : '#a49dc0', fontSize: 12.5 }}>{status}</Text>}
          </Glass>
        </Press>
        <Press onPress={hdr} pop round={24}>{G ? <GAvatar g={G} size={48} /> : <Avatar p={p} size={48} />}</Press>
      </View>

      {rnd && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,.75)', alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
          <PopCircle>
            <CameraView ref={cam} style={{ width: 290, height: 290 }} facing="front" mode="video" videoQuality="480p" videoBitrate={1200000} mute={false} onCameraReady={rndReady} />
          </PopCircle>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 22 }}>
            <RecDot /><Text style={{ color: '#fff', fontSize: 17, marginLeft: 8, fontVariant: ['tabular-nums'] }}>{rnd.ready ? <RndTimer t0={rnd.t0} /> : 'камера…'}</Text>
          </View>
          <Text style={{ color: C.mute, marginTop: 8 }}>отпусти — отправить</Text>
        </View>
      )}
      {att && <AttachSheet chatId={c} onClose={() => setAtt(false)} onCamera={takePhoto} onPickMedia={pickMedia} onPickFile={pickFile} onPickRaw={pickRaw} onPickAudio={pickAudio}
        onSendAssets={sendAssets} onOpenAsset={openAsset} onSendText={t => sendText(to, c, t).catch(e => toast(e.message, 1))}
        onForward={f => ms('fwd', { c: f.c, i: f.i, to, plain: 1 }).then(poke).catch(e => toast(e.message, 1))} />}
      {menu && <MsgMenu c={c} G={G} menu={menu} canW={canW} onClose={() => setMenu(null)} onReply={m => setReply(m)}
        onEdit={m => { setReply(null); setEditing(m); const e = S.ed[c] && S.ed[c][m.i]; setTxt(e != null ? (typeof e === 'object' ? e.x : e) : m.x); }}
        onForward={m => navigation.navigate('Forward', { c, i: m.i })} />}
      {pinM && (
        <View style={{ position: 'absolute', top: ins.top + 56, left: 8, right: 8 }}>
          <Press pop round={16} amt={0.03} onPress={() => toast('Закреплено: ' + (pinM.x || 'вложение').slice(0, 40))}>
            <Glass round={16} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7 }}>
              <View style={{ width: 2, alignSelf: 'stretch', backgroundColor: C.blue, borderRadius: 1, marginRight: 10 }} />
              <View style={{ flex: 1 }}><Text style={{ color: C.blue, fontSize: 13, fontWeight: '700' }}>Закреплённое сообщение</Text><Text numberOfLines={1} style={{ color: '#fff', fontSize: 14 }}>{pinM.x || (pinM.fl ? (pinM.fl.vo ? 'Голосовое' : pinM.fl.rd ? 'Кружок' : (pinM.fl.ty || '').startsWith('image/') ? 'Фото' : pinM.fl.n) : '')}</Text></View>
              <Ionicons name="pin" size={18} color={C.mute} />
            </Glass>
          </Press>
        </View>
      )}
    </View>
  );
}

function MicBtn({ on, mode, busy }) {
  const a = useRef(new Animated.Value(0)).current, f = useRef(new Animated.Value(mode === 'cam' ? 1 : 0)).current;
  useEffect(() => { Animated.spring(a, { toValue: on ? 1 : 0, useNativeDriver: true, speed: 16, bounciness: 12 }).start(); }, [on]);
  useEffect(() => { f.setValue(0); Animated.spring(f, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 14 }).start(); }, [mode]);
  return (
    <Animated.View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: on ? C.blue : 'rgba(37,37,40,.62)', borderWidth: 1, borderColor: 'rgba(255,255,255,.09)', alignItems: 'center', justifyContent: 'center', transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }] }}>
      {busy ? <ActivityIndicator color="#fff" size="small" /> : (
        <Animated.View style={{ transform: [{ scale: f.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }, { rotate: f.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] }) }] }}>
          <Ionicons name={mode === 'cam' ? 'videocam' : 'mic'} size={23} color="#fff" />
        </Animated.View>
      )}
    </Animated.View>
  );
}
function PopCircle({ children }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 12 }).start(); }, []);
  return <Animated.View style={{ width: 290, height: 290, borderRadius: 145, overflow: 'hidden', backgroundColor: '#111', transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }], opacity: a }}>{children}</Animated.View>;
}
function RndTimer({ t0 }) {
  const [, f] = useState(0);
  useEffect(() => { const iv = setInterval(() => f(x => x + 1), 250); return () => clearInterval(iv); }, []);
  const t = Math.floor((Date.now() - t0) / 1000);
  return <Text>{Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0')}</Text>;
}
function RecDot() {
  const a = useRef(new Animated.Value(1)).current;
  useEffect(() => { const l = Animated.loop(Animated.sequence([Animated.timing(a, { toValue: 0.2, duration: 500, useNativeDriver: true }), Animated.timing(a, { toValue: 1, duration: 500, useNativeDriver: true })])); l.start(); return () => l.stop(); }, []);
  return <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.red, opacity: a }} />;
}
function SendBtn({ on, onPress, busy }) {
  const a = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => { Animated.spring(a, { toValue: on ? 1 : 0, useNativeDriver: true, speed: 20, bounciness: 12 }).start(); }, [on]);
  return (
    <Press onPress={onPress} disabled={!on} pop round={22}>
      <Animated.View style={{ transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }], opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: on ? C.blue : 'rgba(37,37,40,.62)', alignItems: 'center', justifyContent: 'center' }}>
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
  const isImg = fl && (fl.ty || '').startsWith('image/') && !fl.rd;
  const isVid = fl && !isImg && !fl.vo && ((fl.ty || '').startsWith('video/') || fl.rd);
  const rx = S.rx[c] && S.rx[c][m.i];
  const pop = useRef(new Animated.Value(m.tmp ? 0 : 1)).current;
  useEffect(() => { if (m.tmp) Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 10 }).start(); }, []);
  const bg = mine ? C.me : C.th;
  const r = 19, sm = 6;
  // свайп влево — ответить (как в Telegram): пузырь едет за пальцем, появляется стрелка
  const sw = useRef(new Animated.Value(0)).current, fired = useRef(false);
  const pr = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dx < -12 && Math.abs(g.dx) > Math.abs(g.dy) * 2.2,
    onPanResponderMove: (_, g) => { const v = Math.max(-90, Math.min(0, g.dx)); sw.setValue(v); if (v < -60 && !fired.current) { fired.current = true; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); } },
    onPanResponderRelease: () => { if (fired.current) onReply(); fired.current = false; Animated.spring(sw, { toValue: 0, useNativeDriver: true, bounciness: 10 }).start(); },
    onPanResponderTerminate: () => { fired.current = false; Animated.spring(sw, { toValue: 0, useNativeDriver: true }).start(); },
  })).current;
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
    <Animated.View {...pr.panHandlers} style={{ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: first ? 6 : 2, opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }, { translateX: sw }] }}>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', right: -40, top: 0, bottom: 0, justifyContent: 'center', opacity: sw.interpolate({ inputRange: [-70, -20, 0], outputRange: [1, 0, 0] }), transform: [{ scale: sw.interpolate({ inputRange: [-70, -20, 0], outputRange: [1, 0.4, 0.4], extrapolate: 'clamp' }) }] }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,.15)', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="arrow-undo" size={16} color="#fff" /></View>
      </Animated.View>
      {gs && <View style={{ width: 38, justifyContent: 'flex-end' }}>{last && <Pressable onPress={() => onUser(m.f)}><Avatar p={S.peers[m.f]} size={32} /></Pressable>}</View>}
      <Pressable onLongPress={e => onLong(m, e)} delayLongPress={280} onPress={fl && !fl.local && (isImg || (fl.ty || '').startsWith('video/') || fl.rd || (!fl.vo)) ? () => onImg(m) : undefined} style={{ maxWidth: MAXW }}>
        <LinearGradient colors={mine ? ['#4a95ff', '#2a6fe0'] : [C.th, C.th]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[{ overflow: 'hidden' }, radius, isImg ? { padding: 3 } : { paddingLeft: 12, paddingRight: 10, paddingTop: 7, paddingBottom: 6 }]}>
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
          {isVid && (fl.th || fl.local) ? (
            <View style={{ margin: -8, marginBottom: x ? 0 : -4 }}>
              <Image source={{ uri: fl.th || fl.local }} style={{ width: fl.rd ? 220 : Math.min(MAXW, 280), height: fl.rd ? 220 : Math.min(360, Math.max(140, Math.min(MAXW, 280) * ((fl.h || 9) / (fl.w || 16)))), borderRadius: fl.rd ? 110 : 15 }} contentFit="cover" />
              <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,.45)', alignItems: 'center', justifyContent: 'center' }}>{m.tmp ? <ActivityIndicator color="#fff" /> : <Ionicons name="play" size={26} color="#fff" style={{ marginLeft: 3 }} />}</View></View>
              {!!fl.d && <View style={{ position: 'absolute', left: 8, top: 8, backgroundColor: 'rgba(0,0,0,.45)', borderRadius: 9, paddingHorizontal: 6 }}><Text style={{ color: '#fff', fontSize: 12 }}>{Math.floor(fl.d / 60)}:{String(fl.d % 60).padStart(2, '0')}</Text></View>}
            </View>
          ) : fl && !isImg && !fl.vo && <FileRow fl={fl} mine={mine} />}
          {!!x && /^📍 /.test(x) && (() => { const g = /mlat=(-?[\d.]+)&mlon=(-?[\d.]+)/.exec(x); if (!g) return null; return (
            <Pressable onPress={() => Linking.openURL(`geo:${g[1]},${g[2]}?q=${g[1]},${g[2]}`).catch(() => Linking.openURL(x.split('\n')[1]))} style={{ margin: -4, marginBottom: 4 }}>
              <MapTiles lat={+g[1]} lon={+g[2]} w={240} h={150} round={14} />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginTop: 6, marginLeft: 4 }}>{x.split('\n')[0].replace('📍 ', '')}</Text>
            </Pressable>); })()}
          {!!x && /^👤 /.test(x) && (() => { const id = (/#msgp-(\d+)/.exec(x) || [])[1]; return (
            <Pressable onPress={() => id && onUser(id)} style={{ flexDirection: 'row', alignItems: 'center', minWidth: 200, paddingVertical: 2 }}>
              <Avatar p={S.peers[id]} size={42} />
              <View style={{ marginLeft: 10 }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{x.split('\n')[0].replace('👤 ', '')}</Text><Text style={{ color: mine ? '#cfe0ff' : C.blue, fontSize: 13 }}>Контакт · открыть профиль</Text></View>
            </Pressable>); })()}
          {!!x && !/^(📍|👤) /.test(x) && <Text style={{ color: '#fff', fontSize: 15.5, lineHeight: 21, marginHorizontal: isImg ? 8 : 0, marginTop: isImg ? 4 : 0 }} selectable={false}>{x}</Text>}
          <View style={isImg && !x ? { position: 'absolute', right: 10, bottom: 8, backgroundColor: 'rgba(0,0,0,.45)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 } : { marginHorizontal: isImg ? 8 : 0, marginBottom: isImg ? 4 : 0 }}>{meta}</View>
        </LinearGradient>
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
        <Press key={r.e} onPress={() => ms('react', { c, i, e: r.e }).then(poke).catch(() => {})} pop round={14} amt={0.18} style={{ marginRight: 4, marginTop: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: r.me ? C.blue : 'rgba(255,255,255,.14)', borderRadius: 14, paddingHorizontal: 8, height: 28 }}>
            <Text style={{ fontSize: 15 }}>{r.e}</Text>{r.n > 1 && <Text style={{ color: '#fff', fontSize: 13, marginLeft: 3, fontWeight: '600' }}>{r.n}</Text>}
          </View>
        </Press>
      ))}
    </View>
  );
}

// сохранить фото/видео в галерею телефона
async function saveToGallery(fl) {
  try {
    const p = await MediaLibrary.requestPermissionsAsync(true);
    if (!p.granted) return toast('Разреши доступ к галерее', 1);
    toast('Сохраняю…');
    const ext = (fl.n || '').includes('.') ? fl.n.split('.').pop() : (fl.ty || '').startsWith('video/') ? 'mp4' : 'jpg';
    const dst = FileSystem.cacheDirectory + 'mundere_' + Date.now() + '.' + ext;
    const r = await FileSystem.downloadAsync(fileUri(fl.id), dst, { headers: authed('').headers });
    await MediaLibrary.saveToLibraryAsync(r.uri);
    toast('Сохранено в галерею');
  } catch (e) { toast('Не удалось сохранить', 1); }
}
// файл: скачиваем в кэш и открываем через «Поделиться/Открыть в…»
async function openDoc(fl) {
  try {
    toast('Скачиваю ' + fl.n);
    const dst = FileSystem.cacheDirectory + encodeURIComponent(fl.id) + '_' + String(fl.n || 'file').replace(/[^\w.\-а-яА-ЯёЁ]/g, '_');
    const r = await FileSystem.downloadAsync(fileUri(fl.id), dst, { headers: authed('').headers });
    const Sharing = require('expo-sharing');
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(r.uri, { mimeType: fl.ty || undefined, dialogTitle: fl.n });
    else toast('Файл сохранён', 0);
  } catch (e) { toast('Не удалось открыть файл', 1); }
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
  const [rate, setRate] = useState(1);
  const nextRate = () => { const r = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(r); tap(); try { pl.current && pl.current.setPlaybackRate(r); } catch (e) {} };
  const pl = useRef(null);
  useEffect(() => () => { try { pl.current && pl.current.remove(); } catch (e) {} }, []);
  function toggle() {
    if (m.tmp || !m.fl.id) return;
    tap();
    if (!pl.current) {
      const p = createAudioPlayer(authed(fileUri(m.fl.id)));
      p.addListener('playbackStatusUpdate', s => {
        setSt(o => ({ play: !!s.playing, pos: s.currentTime || 0, dur: s.duration || o.dur }));
        if (s.didJustFinish) { try { p.seekTo(0); } catch (e) {} setSt(o => ({ ...o, play: false, pos: 0 })); }
      });
      pl.current = p; try { p.setPlaybackRate(rate); } catch (e) {} p.play(); setSt(o => ({ ...o, play: true })); return;
    }
    if (st.play) pl.current.pause(); else pl.current.play();
  }
  const bars = useMemo(() => {
    const wf = m.fl.wf || '';
    if (wf.length >= 8) { const v = [...wf].map(ch => parseInt(ch, 36) || 0), mx = Math.max(1, ...v); return Array.from({ length: 28 }, (_, k) => 3 + (v[Math.floor(k * v.length / 28)] / mx) * 18); }
    return Array.from({ length: 28 }, (_, k) => 4 + Math.abs(Math.sin((m.i + 1) * 7.3 + k * 1.7)) * 16);
  }, [m.i, m.fl.wf]);
  const fr = st.dur ? st.pos / st.dur : 0;
  const t = Math.round(st.play || st.pos ? st.pos : st.dur);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 210, paddingVertical: 2 }}>
      <Press onPress={toggle} pop round={21} amt={0.15}>
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: mine ? '#fff' : C.blue, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={st.play ? 'pause' : 'play'} size={20} color={mine ? C.me : '#fff'} style={{ marginLeft: st.play ? 0 : 2 }} />
        </View>
      </Press>
      <View style={{ marginLeft: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 22 }}>
          {bars.map((h, k) => <View key={k} style={{ width: 3, height: h, borderRadius: 2, marginRight: 2, backgroundColor: k / bars.length <= fr ? (mine ? '#fff' : C.blue) : mine ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.3)' }} />)}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
          <Text style={{ color: mine ? '#cfe0ff' : C.mute, fontSize: 12 }}>{Math.floor(t / 60)}:{String(t % 60).padStart(2, '0')}</Text>
          {(st.play || st.pos > 0) && <Press onPress={nextRate} pop round={9} amt={0.2} style={{ marginLeft: 8 }}><View style={{ backgroundColor: mine ? 'rgba(255,255,255,.25)' : 'rgba(47,140,255,.25)', borderRadius: 9, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{rate}x</Text></View></Press>}
        </View>
      </View>
    </View>
  );
}

// Меню сообщения: затемнение, реакции и пункты выплывают пузырьком от пальца
function MsgMenu({ c, G, menu, canW, onClose, onReply, onEdit, onForward }) {
  const a = useRef(new Animated.Value(0)).current;
  const { m } = menu, mine = String(m.f) === String(M.me);
  const { width: W, height: H } = Dimensions.get('window');
  useEffect(() => { Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 9 }).start(); }, []);
  const close = cb => Animated.timing(a, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => { onClose(); cb && cb(); });
  const canAll = mine || (G && G.admin);
  const items = [
    ...(canW ? [{ t: 'Ответить', ic: 'arrow-undo-outline', fn: () => onReply(m) }] : []),
    ...(m.x ? [{ t: 'Копировать', ic: 'copy-outline', fn: () => { Clipboard.setStringAsync(m.x); toast('Скопировано'); } }] : []),
    ...(mine && m.x && !m.fwd ? [{ t: 'Изменить', ic: 'pencil-outline', fn: () => onEdit(m) }] : []),
    { t: 'Переслать', ic: 'arrow-redo-outline', fn: () => onForward(m) },
    ...(!G || G.admin ? [{ t: S.pin[c] === m.i ? 'Открепить' : 'Закрепить', ic: 'pin-outline', fn: async () => { try { await ms('pin', { c, i: S.pin[c] === m.i ? -1 : m.i }); S.pin[c] = S.pin[c] === m.i ? -1 : m.i; emit(); poke(); } catch (e) { toast(e.message, 1); } } }] : []),
    ...(m.fl && !m.fl.vo && ((m.fl.ty || '').startsWith('image/') || (m.fl.ty || '').startsWith('video/')) ? [{ t: 'Сохранить в галерею', ic: 'download-outline', fn: () => saveToGallery(m.fl) }] : []),
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
